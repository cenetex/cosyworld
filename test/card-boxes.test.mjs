import { describe, expect, it } from "vitest";
import "./helpers/still-cast.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  holdChoice,
  legalActions,
  play,
  sealedWays,
} from "../v2/card-game/world.mjs";
import {
  boxesAt,
  boxOpen,
  boxWant,
  creditOpened,
  validOpened,
} from "../v2/card-game/world/boxes.mjs";
import {
  availableCards,
  cardPlay,
  sealedReason,
} from "../v2/card-game/cards.mjs";
import { isLockedBox, lockedQuest } from "../v2/card-game/locked-box.mjs";
import {
  entityActive,
  entityShown,
  packDefinition,
  packDefinitions,
  packPeople,
  validatePackDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { places } from "../v2/card-game/world/catalog.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { greekErrands } from "./helpers/greek-opening.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";

// Lock view: the Argos tomb is a place with its own `requires`; its route
// carries a seal in the Greek pack (rules 133), so it is drawn shut. What it
// waits on is read from its gate: the choice that opens it is a Give.
const TOMB_GOALS = [
  {
    kind: "item",
    target: "greek-atreid-record",
    step: { verb: "give", to: "greek-ismene" },
  },
];

const walk = (s, place) =>
  greekTravelTargets(s.actors.vale.place, `greek-${place}`).reduce(
    (w, target) => act(w, "move", { target }),
    s,
  );
const flagsOf = (world, packId) => world.packs[packId].flags;
const act = (s, kind, fields = {}, actor) => {
  const action = legalActions(s, actor).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action, `${kind} ${JSON.stringify(fields)}`).toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

describe("the hub's boxes", () => {
  const opening = () => createWorld({ opening: true, seed: 17 });
  it("draws the Black pond as the first box, opened by putting the lamp out", () => {
    const world = opening();
    expect(boxesAt(world, "attic")).toEqual([
      {
        id: "pond",
        kind: "hub",
        at: "attic",
        open: false,
        want: null,
        goals: [{ kind: "item", target: "lamp", lit: false }],
      },
    ]);
    expect(availableCards(world)).toEqual(
      expect.arrayContaining(["attic", "lamp", "vale", "pond"]),
    );
    expect(isLockedBox(world, "pond")).toBe(true);
    // The Lamp is not yet discovered, so the lock does not name it.
    expect(lockedQuest(world, "pond")).toEqual({
      text: "Find something",
      cards: [],
    });
    expect(lockedQuest(world, "pond", () => true).text).toBe(
      "Hold the dark Lamp",
    );
    expect(exits(world, "attic", "vale")).not.toContain("pond");
    expect(legalActions(world).filter((a) => a.target === "pond")).toEqual([]);
    expect(cardPlay(world, ["pond"]).action).toBeFalsy();
    const out = structuredClone(world);
    holdChoice(out, "vale", { item: null, revision: out.revision });
    expect(out.items.lamp.lit).toBe(false);
    expect(boxesAt(out, "attic")[0]).toMatchObject({ id: "pond", open: true });
    expect(exits(out, "attic", "vale")).toContain("pond");
    expect(isLockedBox(out, "pond")).toBe(false);
    expect(out.actors.vale.xp).toBe(world.actors.vale.xp);
    expect(out.opened).toEqual({ pond: ["vale"] });
    expect(validOpened(out)).toBe(true);
    expect(decodeSave(encodeSave(out)).opened).toEqual({ pond: ["vale"] });
  });
  it("pays once: a box that locks again pays nothing more", () => {
    let world = opening();
    holdChoice(world, "vale", { item: null, revision: world.revision });
    const paid = world.actors.vale.xp;
    holdChoice(world, "vale", { item: "lamp", revision: world.revision });
    expect(world.items.lamp.lit).toBe(true);
    expect(boxesAt(world, "attic")[0].open).toBe(false);
    holdChoice(world, "vale", { item: null, revision: world.revision });
    expect(boxesAt(world, "attic")[0].open).toBe(true);
    expect(world.actors.vale.xp).toBe(paid);
    expect(world.opened).toEqual({ pond: ["vale"] });
  });
  it("draws the mirror back to the attic as a box on the shore", () => {
    const world = opening();
    world.actors.vale.place = "pond";
    world.items.lamp.holder = "vale";
    world.items.lamp.lit = false;
    expect(boxesAt(world, "pond")).toEqual([
      expect.objectContaining({
        id: "attic",
        kind: "hub",
        open: false,
        goals: [{ kind: "item", target: "lamp", lit: true }],
      }),
    ]);
    expect(isLockedBox(world, "attic")).toBe(true);
    world.items.lamp.lit = true;
    expect(boxesAt(world, "pond")[0].open).toBe(true);
  });
  it("leaves the lit arch to the Empty station a plain exit", () => {
    const world = opening();
    world.actors.vale.place = "pond";
    expect(boxesAt(world, "pond").map((box) => box.id)).not.toContain(
      "station",
    );
    expect(exits(world, "pond", "vale")).toContain("station");
    expect(boxesAt(world, "station")).toEqual([]);
  });
});

describe("the lock view", () => {
  const atRoad = () => {
    const world = createWorld();
    world.packs["greek-drama"].scope = "full";
    world.actors.vale.place = "greek-argolid-road";
    return world;
  };
  it("draws a box whose card has its own conditions, and keeps it shut", () => {
    const world = atRoad();
    expect(entityActive(world, "greek-argos-tomb")).toBe(false);
    expect(entityShown(world, "greek-argos-tomb")).toBe(true);
    expect(
      boxesAt(world, "greek-argolid-road").find(
        (box) => box.id === "greek-argos-tomb",
      ),
    ).toMatchObject({
      kind: "way",
      open: false,
      goals: TOMB_GOALS,
    });
    expect(availableCards(world)).toContain("greek-argos-tomb");
    expect(isLockedBox(world, "greek-argos-tomb")).toBe(true);
    expect(exits(world, "greek-argolid-road", "vale")).not.toContain(
      "greek-argos-tomb",
    );
    expect(
      legalActions(world).filter(
        (a) => a.target === "greek-argos-tomb" || a.item === "greek-argos-tomb",
      ),
    ).toEqual([]);
    expect(
      play(world, { key: "move:vale::greek-argos-tomb" }, world.revision).ok,
    ).toBe(false);
    expect(cardPlay(world, ["greek-argos-tomb"]).action).toBeFalsy();
    expect(entityActive(world, "greek-argos-tomb")).toBe(false);
  });
  it("opens on its old condition", () => {
    const world = atRoad();
    world.packs["greek-drama"].choices["greek-atreid-account"] = "aeschylus";
    expect(entityActive(world, "greek-argos-tomb")).toBe(true);
    expect(exits(world, "greek-argolid-road", "vale")).toContain(
      "greek-argos-tomb",
    );
    expect(
      boxesAt(world, "greek-argolid-road").find(
        (box) => box.id === "greek-argos-tomb",
      ),
    ).toMatchObject({ open: true });
    expect(isLockedBox(world, "greek-argos-tomb")).toBe(false);
  });
  it("keeps the old sealed-ways list and the box list in step", () => {
    for (const world of [atRoad(), greekErrands().decree]) {
      const here = world.actors.vale.place;
      expect(
        sealedWays(world, "vale")
          .map((r) => r.to)
          .sort(),
      ).toEqual(
        boxesAt(world, here, "vale")
          .filter((b) => b.kind === "way" && !b.open)
          .map((b) => b.id)
          .sort(),
      );
    }
  });
});

describe("ways, guards and made things", () => {
  it("shows a guard's way and the goal from the rules", () => {
    const world = greekErrands().decree;
    const [box] = boxesAt(world, world.actors.vale.place, "vale").filter(
      (b) => !b.open,
    );
    expect(box).toMatchObject({
      id: "greek-battlefield",
      kind: "way",
      open: false,
      goals: [
        {
          kind: "item",
          target: "greek-creon-writ",
          step: { verb: "give", to: "greek-guard" },
        },
      ],
    });
    expect(boxOpen(world, box, "vale")).toBe(false);
    expect(boxWant(world, box, "vale")).toEqual({
      kind: "item",
      target: "greek-creon-writ",
      step: { verb: "give", to: "greek-guard" },
    });
  });
  it("lists a made thing locked at its home, with the item in the world", () => {
    const world = createWorld();
    world.actors.vale.place = "greek-courtyard";
    const bread = boxesAt(world, "greek-courtyard", "vale").find(
      (b) => b.id === "greek-bread",
    );
    expect(bread).toMatchObject({ kind: "item", open: false });
    expect(world.items["greek-bread"]).toBeDefined();
    expect(bread.goals).toEqual([
      {
        kind: "item",
        target: "greek-water-jar",
        step: { verb: "bring", at: "greek-courtyard" },
      },
    ]);
  });
});

describe("lanes", () => {
  it("draws a shut lane's port as a box on the ship, with what opens it", () => {
    const world = createWorld();
    world.packs["greek-drama"].scope = "full";
    world.actors.vale.place = "greek-ship";
    expect(world.transports["greek-ship"].dock).toBe("greek-harbor");
    // Patroclus's sealed card lies there too (rules 133): the lane's box is
    // the one under test.
    expect(
      boxesAt(world, "greek-ship").filter((box) => box.kind === "lane"),
    ).toEqual([
      expect.objectContaining({
        id: "greek-piraeus",
        kind: "lane",
        open: false,
        goals: [
          {
            kind: "item",
            target: "greek-provisions",
            step: { verb: "bring", at: "greek-ship" },
          },
        ],
      }),
    ]);
    expect(availableCards(world)).toContain("greek-piraeus");
    expect(isLockedBox(world, "greek-piraeus")).toBe(true);
  });
});

describe("credit for opening a box", () => {
  it("credits a give that makes the bread, once per avatar, with no XP", () => {
    const { waterOffer } = greekErrands();
    const xp = waterOffer.actors.vale.xp;
    expect(waterOffer.opened).toBeUndefined();
    const made = act(waterOffer, "give", {
      item: "greek-water-jar",
      target: "greek-baker",
    });
    expect(made.opened["greek-bread"]).toEqual(["vale"]);
    expect(made.actors.vale.xp).toBe(xp);
    const relocked = structuredClone(made);
    relocked.usedUp = [...relocked.usedUp, "greek-bread"].sort();
    const again = structuredClone(relocked);
    again.usedUp = again.usedUp.filter((id) => id !== "greek-bread");
    expect(creditOpened(relocked, again, "vale")).toEqual([]);
    expect(again.actors.vale.xp).toBe(made.actors.vale.xp);
    again.controlledActors = ["vale", "mara"];
    expect(creditOpened(relocked, again, "mara")).toEqual([
      expect.objectContaining({ box: "greek-bread", avatars: ["mara"] }),
    ]);
    expect(again.opened["greek-bread"]).toEqual(["mara", "vale"]);
  });
  it("credits a guard given the Writ, and not a guard who leaves", () => {
    const writ = walk(greekErrands().writ, "gate");
    const xp = writ.actors.vale.xp;
    const opened = act(writ, "give", {
      item: "greek-creon-writ",
      target: "greek-guard",
    });
    expect(opened.opened["greek-battlefield"]).toEqual(["vale"]);
    expect(opened.actors.vale.xp).toBe(xp);
    // The guard walking off his post is nothing the traveller did.
    const gone = structuredClone(writ);
    gone.actors["greek-guard"].place = "greek-courtyard";
    delete gone.actors["greek-guard"].guarding;
    expect(creditOpened(writ, gone, "vale")).toEqual([]);
    expect(gone.opened["greek-battlefield"]).toBeUndefined();
    // Nor one knocked through in a fight: he is no longer at his post.
    const beaten = structuredClone(writ);
    beaten.actors["greek-guard"].place = "greek-courtyard";
    expect(creditOpened(writ, beaten, "vale")).toEqual([]);
  });
  it("pays a Talk that sets a flag, and no one when the hour turns", () => {
    const world = createWorld({ opening: false });
    const badger = packPeople.badger;
    const saved = { ...badger };
    badger.sealed = { at: "clearing" };
    badger.requires = [{ kind: "clock", from: 0, to: 5 }];
    try {
      world.crossings["pond-clearing"].discovered = true;
      world.actors.vale.place = "clearing";
      world.turn = world.revision = 47;
      expect(entityActive(world, "badger")).toBe(false);
      expect(
        boxesAt(world, "clearing").find((box) => box.id === "badger"),
      ).toMatchObject({
        id: "badger",
        kind: "resident",
        open: false,
      });
      const later = act(world, "wait");
      expect(entityActive(later, "badger")).toBe(true);
      expect(later.opened).toBeUndefined();
      expect(later.actors.vale.xp).toBe(world.actors.vale.xp);
    } finally {
      for (const key of ["sealed", "requires"]) delete badger[key];
      Object.assign(badger, saved);
    }
  });
  it("credits the Hollow's talk, a thing carried, a thing placed and a Raven woken", () => {
    const id = (name) => `ratiradio-${name}`;
    const home = id("listening-room");
    if (!packPeople[id("rati")]) return;
    // This counts the boxes only. RATi's staged keepsake wants (rules 133)
    // also pay a helper's XP when a keepsake comes home; they have their own
    // test (card-greek-staged), so he wants nothing here.
    const staged = packPeople[id("rati")].wants;
    delete packPeople[id("rati")].wants;
    try {
      const s = createWorld({ seed: 17 });
      s.actors[id("rati")].want = null;
      for (const [item, entry] of Object.entries(
        packDefinition("ratiradio").items,
      ))
        if (entry.scatterOutside) s.items[item].holder = entry.holder;
      s.items[id("thermos")].holder = id("staff-kitchen");
      s.actors.vale.place = "pond";
      for (const item of Object.values(s.items))
        if (item.holder === "vale") item.holder = "pond";
      const steps = [
        ["take", id("station-key")],
        ["move", "station"],
        ["move", id("staff-kitchen")],
        ["drop", id("station-key")],
        ["take", id("red-beanie"), id("dispatch-window")],
        ["take", id("thermos")],
        ["move", id("dispatch-window")],
        ["drop", id("thermos"), id("listening-room")],
        ["move", home],
        ["drop", id("red-beanie")],
        ["take", id("raven-figurine")],
        ["gather", id("rati")],
        ["talk", id("rati"), id("broadcast-booth")],
        ["move", id("broadcast-booth")],
        ["take", id("glass")],
        ["move", home],
        ["drop", id("glass")],
        ["drop", id("raven-figurine"), id("raven")],
      ];
      let world = s;
      for (const [kind, target, paid] of steps) {
        if (kind === "gather") {
          world.actors[target].place = world.actors.vale.place;
          continue;
        }
        const before = world.actors.vale.xp;
        world = act(
          world,
          kind,
          kind === "talk" || kind === "move" ? { target } : { item: target },
        );
        expect(world.actors.vale.xp - before, `${kind} ${target}`).toBe(0);
        if (paid) expect(world.opened[paid]).toContain("vale");
      }
      expect(Object.keys(world.opened).sort()).toEqual(
        [
          id("broadcast-booth"),
          id("dispatch-window"),
          id("listening-room"),
          id("raven"),
        ].sort(),
      );
    } finally {
      packPeople[id("rati")].wants = staged;
    }
  });
});

describe("a box shut for a shared world", () => {
  const solo = () => createWorld();
  const shared = () => dispatchShared({ op: "create", seed: 9 }).world;
  const allPlaces = () => Object.keys(places);
  it("draws no home door in a single-player world", () => {
    const world = solo();
    for (const place of allPlaces(world))
      expect(
        boxesAt(world, place).filter((b) => b.kind === "crossing"),
      ).toEqual([]);
  });
  it("draws each home's door only where this world put it", () => {
    const world = shared();
    const doors = Object.entries(world.doors);
    expect(doors).toHaveLength(7);
    const seen = {};
    for (const place of allPlaces(world))
      for (const box of boxesAt(world, place, "mara").filter(
        (b) => b.kind === "crossing",
      )) {
        (seen[box.id] ??= []).push(place);
        expect(box.open).toBe(false);
        expect(box.goals).toEqual([
          expect.objectContaining({
            kind: "item",
            step: { verb: "bring", at: place },
          }),
        ]);
      }
    for (const [home, place] of doors) expect(seen[home]).toEqual([place]);
  });
});

describe("a lock for two", () => {
  it("opens when two travellers stand together and credits both once", () => {
    const badger = packPeople.badger;
    const saved = { ...badger };
    badger.sealed = { at: "station" };
    badger.requires = [{ kind: "humans_at", place: "station", minimum: 2 }];
    try {
      const world = dispatchShared({ op: "create", seed: 9 }).world;
      const seats = ["mara", "ash"];
      Object.assign(world, { controlledActors: seats, presentActors: seats });
      world.actors.mara.place = "station";
      world.actors.ash.place = "pond";
      expect(entityActive(world, "badger")).toBe(false);
      expect(boxesAt(world, "station", "mara")[0]).toMatchObject({
        id: "badger",
        open: false,
      });
      const next = act(world, "move", { target: "station" }, "ash");
      expect(entityActive(next, "badger")).toBe(true);
      expect(next.opened.badger).toEqual(["ash", "mara"]);
      expect(next.actors.ash.xp).toBe(world.actors.ash.xp);
      expect(next.actors.mara.xp).toBe(world.actors.mara.xp);
      // Walking out and in again pays nothing more.
      const out = act(next, "move", { target: "pond" }, "ash");
      const back = act(out, "move", { target: "station" }, "ash");
      expect(back.actors.ash.xp).toBe(next.actors.ash.xp);
      expect(back.actors.mara.xp).toBe(next.actors.mara.xp);
    } finally {
      for (const key of ["sealed", "requires"]) delete badger[key];
      Object.assign(badger, saved);
    }
  });
  it("accepts humans_at in pack data only with a place and a minimum", () => {
    const pack = structuredClone(
      packDefinitions.find((p) => p.id === "badger-forest"),
    );
    pack.avatars.badger.requires = [{ kind: "humans_at", minimum: 2 }];
    expect(() => validatePackDefinition(pack)).toThrow();
    pack.avatars.badger.requires = [
      { kind: "humans_at", place: "clearing", minimum: 2 },
    ];
    expect(() => validatePackDefinition(pack)).not.toThrow();
    pack.avatars.badger.requires[0].minimum = 0;
    expect(() => validatePackDefinition(pack)).toThrow();
  });
});

describe("the saved record of opened boxes", () => {
  const valid = () => {
    const world = createWorld({ opening: true });
    holdChoice(world, "vale", { item: null, revision: world.revision });
    return world;
  };
  it("is absent in a new world and sorted, known and non-empty once written", () => {
    expect(createWorld().opened).toBeUndefined();
    expect(validOpened(valid())).toBe(true);
    const bad = [
      (s) => (s.opened = {}),
      (s) => (s.opened = []),
      (s) => (s.opened = { nowhere: ["vale"] }),
      (s) => (s.opened = { pond: [] }),
      (s) => (s.opened = { pond: ["nobody"] }),
      (s) => (s.opened = { pond: ["vale", "vale"] }),
      (s) => (s.opened = { pond: ["vale", "mara"] }),
      (s) => (s.opened = { pond: "vale" }),
    ];
    for (const damage of bad) {
      const s = valid();
      damage(s);
      expect(validOpened(s)).toBe(false);
      expect(() => decodeSave(encodeSave(s))).toThrow();
    }
  });
  it("replays: the same play pays the same on a reloaded save", () => {
    const world = createWorld({ opening: true });
    const request = { item: null, revision: world.revision };
    const a = structuredClone(world),
      b = decodeSave(encodeSave(world));
    holdChoice(a, "vale", request);
    holdChoice(b, "vale", request);
    expect(b.opened).toEqual(a.opened);
    expect(b.actors.vale.xp).toBe(a.actors.vale.xp);
  });
  it("is not part of a pack's exact state", () => {
    const world = valid();
    expect(
      Object.keys(world.packs).every((id) => !("opened" in world.packs[id])),
    ).toBe(true);
    expect(flagsOf(world, "greek-drama")).toBeDefined();
  });
});
