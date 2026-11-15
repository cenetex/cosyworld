import { describe, expect, it } from "vitest";
import { createWorld, legalActions, play, questPreviews } from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  TAROT_BACK,
  TAROT_LOCKED_BACK,
  createLockedBoxes,
  isLockedBox,
  lockedQuest,
} from "../v2/card-game/locked-box.mjs";
import { existsSync } from "node:fs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { greekErrands } from "./helpers/greek-opening.mjs";
import { settleGate } from "./helpers/world-life.mjs";

import { questsOf } from "../v2/card-game/want.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";
import { UNKNOWN } from "../v2/card-game/world/want-words.mjs";
import { isArcanum } from "../v2/card-game/world/arcana.mjs";

function act(s, kind, fields = {}) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  const result = play(s, action, s.revision);
  expect(result.ok, `${kind} ${result.error}`).toBe(true);
  return result.state;
}
const walk = (s, place) =>
  greekTravelTargets(s.actors.vale.place, `greek-${place}`).reduce(
    (w, target) => act(w, "move", { target }),
    s,
  );

describe("locked boxes", () => {
  it("shows a crafted item's next requirement without changing the world", () => {
    const s = createWorld();
    s.packs["greek-drama"].scope = "full";
    s.actors.vale.place = "greek-harbor";
    const before = JSON.stringify(s);
    expect(lockedQuest(s, "greek-provisions", () => true)).toEqual({
      text: "Bring Courtyard Bread to The Wine-Dark Harbor",
      cards: [],
    });
    // A box lies where it is kept: the bread, in the courtyard.
    s.actors.vale.place = "greek-courtyard";
    expect(lockedQuest(s, "greek-bread", () => true)).toEqual({
      text: "Bring Water Jar to Theban Courtyard",
      cards: [],
    });
    expect(lockedQuest(s, "greek-creon-writ")).toBeNull();
    s.actors.vale.place = "greek-harbor";
    expect(JSON.stringify(s)).toBe(before);
    s.usedUp = s.usedUp.filter((id) => id !== "greek-provisions");
    expect(lockedQuest(s, "greek-provisions")).toBeNull();
  });
  it("shows the lock's own conditions when its route names no quest", () => {
    const route = packDefinitions
      .find((pack) => pack.id === "greek-drama")
      .routes.find((entry) => entry.to === "greek-polynices-hollow");
    const quest = route.sealed.quest;
    delete route.sealed.quest;
    try {
      const world = createWorld();
      world.packs["greek-drama"].scope = "full";
      world.actors.vale.place = "greek-battlefield";
      expect(lockedQuest(world, "greek-polynices-hollow", () => true)).toEqual({
        text: "Talk with Polynices' Shade",
        cards: [],
      });
      // The Shade is not yet met: the lock does not name him.
      expect(lockedQuest(world, "greek-polynices-hollow").text).toBe(
        "Meet someone",
      );
    } finally {
      route.sealed.quest = quest;
    }
  });
  it("does not show a box for the always-open Cithaeron road", () => {
    const s = createWorld();
    s.packs["greek-drama"].scope = "full";
    s.actors.vale.place = "greek-battlefield";
    expect(isLockedBox(s, "greek-cithaeron")).toBe(false);
    expect(lockedQuest(s, "greek-cithaeron")).toBeNull();
  });
  it("lock the sealed card alone until its quest opens the way", () => {
    let s = greekErrands().decree;
    expect(
      availableCards(s).filter((id) => isLockedBox(s, id) && !isArcanum(id)),
    ).toEqual(["greek-battlefield"]);
    expect(lockedQuest(s, "greek-battlefield")).toEqual({
      text: `Give ${UNKNOWN.item} to ${UNKNOWN.person}`,
      cards: [],
    });
    expect(lockedQuest(s, "greek-battlefield", () => true)).toEqual({
      text: "Give Creon's Writ to The Gate Guard",
      cards: [],
    });
    const hidden = lockedQuest(s, "greek-battlefield", () => false);
    expect(hidden).toEqual({
      text: `Give ${UNKNOWN.item} to ${UNKNOWN.person}`,
      cards: [],
    });
    expect(hidden.text).not.toMatch(/Creon|Writ|Gate Guard/u);
    const far = structuredClone(s);
    far.actors.vale.place = "greek-battlefield";
    expect(lockedQuest(far, "greek-gate", () => true)).toEqual({
      text: "Give Creon's Writ to The Gate Guard",
      cards: [],
    });
    expect(questsOf(s, "vale")).toEqual([]);
    s = play(s, questPreviews(s).find((q) => q.source === "greek-battlefield").action).state;
    expect(questsOf(s, "vale").map((w) => w.from)).toContain(
      "quest:box:greek-battlefield",
    );
    s = act(s, "talk", { target: "greek-guard" });
    s = play(s, questPreviews(s).find((q) => q.source === "greek-guard").action).state;
    expect(questsOf(s, "vale")[0].from).toBe("quest:from:greek-guard");
    expect(questsOf(s, "vale").map((w) => w.from)).toContain(
      "quest:box:greek-battlefield",
    );
    expect(questsOf(s, "vale")).toContainEqual(
      expect.objectContaining({ kind: "item", target: "greek-bread" }),
    );
    expect(isLockedBox(s, "greek-battlefield")).toBe(true);
    // The bread buys the decree, the decree Creon's writ, and the writ in
    // the guard's hands opens the way.
    s = act(walk(s, "courtyard"), "take", { item: "greek-bread" });
    s = act(walk(s, "gate"), "trade", {
      item: "greek-bread",
      receive: "greek-decree",
    });
    expect(isLockedBox(s, "greek-battlefield")).toBe(true);
    s = act(walk(s, "palace"), "trade", {
      item: "greek-decree",
      receive: "greek-creon-writ",
    });
    s = act(walk(s, "gate"), "give", {
      item: "greek-creon-writ",
      target: "greek-guard",
    });
    expect(isLockedBox(s, "greek-battlefield")).toBe(false);
  });

  it("lock the same card for a shared seat, from the same world state", () => {
    // Shared play builds its client world from the server's world JSON
    // (sharedWorld in app.mjs), so a seated traveller sees the same box.
    const base = greekErrands().decree;
    const shared = seatActors(
      { ...structuredClone(base), playerActorId: "mara" },
      ["mara"],
      ["mara"],
    );
    shared.actors.mara.place = "greek-gate";
    expect(isLockedBox(shared, "greek-battlefield")).toBe(true);
    expect(availableCards(shared)).toContain("greek-battlefield");
    shared.items["greek-creon-writ"].holder = "greek-guard";
    expect(isLockedBox(settleGate(shared), "greek-battlefield")).toBe(false);
  });

  it("previews the actor's own conversation requirement without adding a quest", () => {
    const pack = packDefinitions.find((entry) => entry.id === "greek-drama");
    const route = pack.routes.find(
      (entry) =>
        entry.from === "greek-battlefield" &&
        entry.to === "greek-polynices-hollow",
    );
    const beforeRequires = route.requires;
    const beforeTravelerRequires = route.travelerRequires;
    route.requires = [{ kind: "flag", key: "preview-open", value: true }];
    route.travelerRequires = [
      { kind: "talked", person: "greek-polynices-shade" },
    ];
    try {
      const world = createWorld();
      world.sharedVersion = 1;
      world.playerActorId = "mara";
      world.controlledActors = ["mara"];
      world.presentActors = ["mara"];
      world.actors.mara.place = "greek-battlefield";
      world.actors.vale.place = "greek-battlefield";
      world.packs[pack.id].scope = "full";
      world.packs[pack.id].flags["preview-open"] = true;
      world.conversations = [
        {
          actors: ["greek-polynices-shade", "vale"].sort(),
          seq: 1,
          turn: 0,
        },
      ];
      const saved = JSON.stringify(world);
      expect(lockedQuest(world, "greek-polynices-hollow", () => true)).toEqual({
        text: "Talk with Polynices' Shade",
        cards: [],
      });
      expect(questsOf(world, "mara")).toEqual([]);
      expect(JSON.stringify(world)).toBe(saved);
      world.conversations.push({
        actors: ["greek-polynices-shade", "mara"].sort(),
        seq: 2,
        turn: 0,
      });
      expect(lockedQuest(world, "greek-polynices-hollow")).toBeNull();
    } finally {
      route.requires = beforeRequires;
      if (beforeTravelerRequires === undefined) delete route.travelerRequires;
      else route.travelerRequires = beforeTravelerRequires;
    }
  });

  it("shows a crafted item's unmet ingredient in quest wording", () => {
    const world = createWorld();
    world.packs["greek-drama"].scope = "full";
    world.actors.vale.place = "greek-courtyard";
    expect(lockedQuest(world, "greek-bread", () => true)).toEqual({
      text: "Bring Water Jar to Theban Courtyard",
      cards: [],
    });
  });

  it("previews the item needed for a shut ship lane", () => {
    const world = createWorld();
    world.packs["greek-drama"].scope = "full";
    world.actors.vale.place = "greek-ship";
    world.transports["greek-ship"].dock = "greek-harbor";
    expect(lockedQuest(world, "greek-piraeus", () => true)).toEqual({
      text: "Lay Travel Provisions in The Charybdis",
      cards: [],
    });
  });

  it("keeps observed locks pending until an eligible available box is unlocked", () => {
    const boxes = createLockedBoxes();
    expect(boxes.observe(["field", "way"])).toBe(true);
    expect(boxes.observe(["field"])).toBe(false);
    boxes.observe([]);
    expect(boxes.ids()).toEqual(["field", "way"]);
    expect(boxes.unlock("field", ["field"], ["field"])).toBe(false);
    expect(boxes.unlock("way", ["field"], [])).toBe(false);
    expect(boxes.unlock("field", ["field"], [])).toBe(true);
    expect(boxes.boxed("field")).toBe(false);
    expect(boxes.unlock("field", ["field"], [])).toBe(false);
    expect(boxes.ids()).toEqual(["way"]);
  });

  it("restores pending lids without covering already open legacy cards", () => {
    const boxes = createLockedBoxes();
    boxes.observe([]);
    expect(boxes.boxed("field")).toBe(false);
    boxes.restore(["way", "way"]);
    expect(boxes.ids()).toEqual(["way"]);
    const saved = boxes.ids();
    saved.push("field");
    expect(boxes.boxed("field")).toBe(false);
    boxes.clear();
    expect(boxes.ids()).toEqual([]);
    boxes.restore(["way"]);
    expect(boxes.unlock("way", ["way"], [])).toBe(true);
    boxes.observe(["way"]);
    expect(boxes.boxed("way")).toBe(true);
  });
});

describe("tarot backs", () => {
  it("draws a face-down tarot with the star back and a locked one with the keyhole back", () => {
    expect(TAROT_BACK).toBe("./assets/arcana/tarot-back.png");
    expect(TAROT_LOCKED_BACK).toBe("./assets/arcana/tarot-back-locked.png");
    for (const back of [TAROT_BACK, TAROT_LOCKED_BACK])
      expect(existsSync(new URL(`../v2/card-game/${back.slice(2)}`, import.meta.url))).toBe(true);
  });
});
