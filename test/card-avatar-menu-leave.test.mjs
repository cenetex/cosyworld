import { describe, expect, it } from "vitest";
import {
  joinable,
  leaveNote,
  targetsFor,
  worldSeats,
  worldSlots,
} from "../v2/card-game/avatar-menu.mjs";

const mara = { id: "mara", name: "Mara" };

describe("leaving", () => {
  it("takes the level along and frees the seat (#1846)", () => {
    expect(leaveNote(mara, { shared: "w1", name: "The Quiet Ferry" })).toBe(
      "Mara keeps their level; the seat in The Quiet Ferry opens.",
    );
    expect(leaveNote(mara, null)).toBe("");
  });
});

describe("worlds an avatar can go to (#1825)", () => {
  const ash = { id: "ash", name: "Ash" };
  it("offers a world where this person returns as the same avatar", () => {
    expect(joinable({ actor: null, bound: "mara", full: true }, mara)).toBe(
      true,
    );
    expect(joinable({ actor: null, bound: "mara", full: false }, ash)).toBe(
      false,
    );
  });
  it("offers a free world only while it has room", () => {
    expect(joinable({ actor: null, bound: null, full: false }, ash)).toBe(true);
    expect(joinable({ actor: null, bound: null, full: true }, ash)).toBe(false);
    expect(joinable({ actor: "vale", bound: "vale", full: false }, ash)).toBe(
      false,
    );
  });
});

describe("a world's seats (#1825, #1877)", () => {
  const state = {
    actor: "vale",
    owner: true,
    bound: [1, 1, 1, 0, 0, 0, 0, 0],
    claimed: [1, 1, 0, 0, 0, 0, 0, 0],
    present: [1, 1, 0, 0, 0, 0, 0, 0],
    holders: [null, "Amber Heron", "Quiet Fox", null, null, null, null, null],
    world: { actors: {} },
  };
  it("marks yours, colours other humans and greys the residents", () => {
    const seats = worldSeats(state);
    // Shown in initial order, R·A·T·V·M·I·C·S (#1846).
    expect(seats.map((s) => s.name)).toEqual([
      "Rue",
      "Ash",
      "Tavi",
      "Vale",
      "Mara",
      "Iris",
      "Cass",
      "Sage",
    ]);
    const kind = Object.fromEntries(seats.map((s) => [s.id, s.kind]));
    expect(kind).toMatchObject({ vale: "you", mara: "human", ash: "human" });
    expect(seats.filter((s) => s.kind === "resident")).toHaveLength(5);
    const online = seats.filter((s) => s.online).map((s) => s.id);
    expect(online).toEqual(["vale", "mara"]);
    const holder = Object.fromEntries(seats.map((s) => [s.id, s.holder]));
    expect(holder).toMatchObject({ vale: "You", mara: "Amber Heron", rue: "" });
  });
  it("lets the owner free every held seat but their own", () => {
    expect(
      worldSeats(state)
        .filter((s) => s.free)
        .map((s) => s.id),
    ).toEqual(["ash", "mara"]);
    expect(worldSeats({ ...state, owner: false }).some((s) => s.free)).toBe(
      false,
    );
  });
  it("shows no seats outside a shared seat", () => {
    expect(worldSeats(null)).toEqual([]);
    expect(worldSeats({ ...state, actor: null })).toEqual([]);
  });
});

describe("the world slots (#1877)", () => {
  const held = (...ids) =>
    ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"].map((id) =>
      ids.includes(id) ? 1 : 0,
    );
  const rows = [
    { id: "w1", owner: true, actor: "vale", held: held("vale", "ash") },
    { id: "w2", owner: true, actor: null, held: held("mara") },
    { id: "w3", owner: false, actor: "tavi", held: held("tavi") },
    { id: "w4", owner: false, actor: null, held: held() },
  ];
  const here = {
    actor: "vale",
    state: {
      actor: "vale",
      owner: true,
      claimed: held("vale", "ash"),
      world: { actors: {} },
    },
    place: { shared: "w1", name: "Hollowmere" },
  };
  const view = worldSlots({ shared: true, rows, here });
  it("lists your slots, current first, and a friend's only while seated", () => {
    expect(view.slots.map((s) => s.key)).toEqual(["w1", "w2", "w3"]);
    expect(view.slots[0]).toMatchObject({ current: true, name: "Hollowmere" });
    expect(view.slots[2].owner).toBe(false);
    expect(view.deck.map((a) => a.id)).toEqual([
      "rue",
      "ash",
      "mara",
      "nell",
      "orin",
      "ada",
    ]);
    expect(view.canCreate).toBe(true);
  });
  it("lights the deck, worlds with that seat free and none of yours, and New world", () => {
    const vale = { id: "vale", name: "Vale" };
    expect(targetsFor(vale, view.slots[0], view)).toEqual({
      deck: true,
      worlds: ["w2"],
      create: true,
    });
    // Mara's seat in w2 is held by someone else.
    const mara = { id: "mara", name: "Mara" };
    expect(targetsFor(mara, null, view).worlds).toEqual([]);
    expect(targetsFor(mara, null, view).deck).toBe(false);
  });
  it("stops New world at eight owned slots", () => {
    const full = [
      rows[0],
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `o${i}`,
        owner: true,
        held: held("mara"),
      })),
    ];
    const eight = worldSlots({ shared: true, rows: full, here });
    expect(eight.slots.filter((s) => s.owner)).toHaveLength(8);
    expect(eight.canCreate).toBe(false);
  });
  it("shows avatars not yet found as card backs, never in the deck (#1936)", () => {
    const found = worldSlots({
      shared: true,
      rows,
      here,
      unlocked: ["vale", "ash", "tavi", "mara"],
    });
    expect(found.deck.map((a) => a.id)).toEqual(["ash", "mara"]);
    expect(found.locked.map((a) => a.id)).toEqual([
      "rue",
      "nell",
      "orin",
      "ada",
    ]);
    expect(found.canCreate).toBe(true);
    // Once everyone is found, no new world opens.
    const all = worldSlots({
      shared: true,
      rows,
      here,
      unlocked: ["rue", "ash", "tavi", "vale", "mara", "nell", "orin", "ada"],
    });
    expect(all.locked).toEqual([]);
    expect(all.canCreate).toBe(false);
  });
  it("opens a friend's link as a slot, with your kept seat free for you", () => {
    const invite = {
      id: "w9",
      claimed: held("ash"),
      bound: held("ash", "mara"),
      mine: "mara",
    };
    const linked = worldSlots({ shared: true, rows, here, invite });
    const slot = linked.slots.find((s) => s.key === "w9");
    expect(slot.invite).toBe(true);
    const mara = { id: "mara", name: "Mara" };
    const ash = { id: "ash", name: "Ash" };
    expect(targetsFor(mara, null, linked).worlds).toContain("w9");
    expect(targetsFor(ash, null, linked).worlds).not.toContain("w9");
  });
  it("signed out, shows no world UI at all (#1892)", () => {
    const solo = worldSlots({
      shared: false,
      rows,
      here: { actor: "vale", place: { local: true, name: "Hollowmere" } },
    });
    expect(solo).toEqual({
      slots: [],
      deck: [],
      locked: [],
      canCreate: false,
    });
  });
  it("signed in at the local table, never lists it (#1892)", () => {
    const view = worldSlots({
      shared: true,
      rows,
      here: { actor: "vale", place: { local: true, name: "Hollowmere" } },
    });
    expect(view.slots.map((s) => s.key)).toEqual(["w1", "w2", "w3"]);
    expect(view.slots.some((s) => s.local || s.current)).toBe(false);
    // Vale sits in w1, so the local Vale is not another copy in the deck.
    expect(view.deck.map((a) => a.id)).not.toContain("vale");
    const fresh = worldSlots({
      shared: true,
      rows: [],
      here: { actor: "vale", place: { local: true, name: "Hollowmere" } },
    });
    expect(fresh.slots).toEqual([]);
    expect(fresh.deck).toHaveLength(8);
    expect(fresh.canCreate).toBe(true);
  });
  it("colours seats online in other worlds and shows their levels", () => {
    const listed = worldSlots({
      shared: true,
      rows: [
        {
          id: "w5",
          owner: true,
          actor: "mara",
          held: held("mara", "ash"),
          online: held("ash"),
          actors: { ash: { level: 4, xp: 9 }, mara: { xp: 3 } },
        },
      ],
      here,
    });
    const seats = listed.slots.find((s) => s.key === "w5").seats;
    const seat = (id) => seats.find((s) => s.id === id);
    expect(seat("ash")).toMatchObject({
      kind: "human",
      online: true,
      level: 4,
    });
    expect(seat("mara")).toMatchObject({
      kind: "you",
      online: false,
      level: 3,
    });
    expect(seat("vale").level).toBe(0);
  });
});
