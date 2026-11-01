import { describe, expect, it } from "vitest";
import {
  afterDelete,
  joinable,
  leaveNote,
  worldSeats,
} from "../v2/card-game/avatar-menu.mjs";
import { humanAvatars } from "../v2/card-game/human-cast.mjs";
import { avatarSlot, deleteLocal } from "../v2/card-game/avatar-world.mjs";

const mara = { id: "mara", name: "Mara" };

describe("leaving a world", () => {
  it("warns that a local world and its progress are lost for good", () => {
    expect(leaveNote(mara, { local: true, name: "Hollowmere" })).toBe(
      "Hollowmere will be lost, with Mara's level and quest there. There is no way back to it.",
    );
  });
  it("takes the level along and frees the seat in a shared world (#1846)", () => {
    expect(leaveNote(mara, { shared: "w1", name: "The Quiet Ferry" })).toBe(
      "Mara's level goes with Mara. Mara's things and quests stay in The Quiet Ferry, and the seat there opens for someone else.",
    );
  });
  it("says nothing when the avatar is in no world", () => {
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

describe("the Table (#1825)", () => {
  const state = {
    actor: "vale",
    owner: true,
    bound: [1, 1, 1, 0, 0, 0, 0, 0],
    claimed: [1, 1, 0, 0, 0, 0, 0, 0],
    present: [1, 1, 0, 0, 0, 0, 0, 0],
    holders: [null, "Amber Heron", "Quiet Fox", null, null, null, null, null],
    world: { actors: {} },
  };
  it("seats each avatar as yours, here, away or open", () => {
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
    expect(kind).toMatchObject({ vale: "you", mara: "human", ash: "away" });
    expect(seats.filter((s) => s.kind === "open")).toHaveLength(5);
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
  it("shows no Table outside a shared seat", () => {
    expect(worldSeats(null)).toEqual([]);
    expect(worldSeats({ ...state, actor: null })).toEqual([]);
  });
});

describe("Delete world (owner bug 2026-11-01)", () => {
  const storage = (entries) => {
    const map = new Map(Object.entries(entries));
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      removeItem: (key) => map.delete(key),
      keys: () => [...map.keys()],
    };
  };
  it("removes the world and its backup, and only that avatar's", () => {
    const slot = avatarSlot("mara");
    const kept = avatarSlot("ash");
    const store = storage({
      [slot]: "a",
      [`${slot}.bak`]: "b",
      [kept]: "c",
    });
    deleteLocal("mara", store);
    expect(store.keys()).toEqual([kept]);
  });
  it("starts the world being played afresh for the same avatar", () => {
    expect(afterDelete(mara, true)).toBe("/?avatar=mara");
    expect(afterDelete({ id: "vale", name: "Vale" }, true)).toBe(
      "/?avatar=vale",
    );
  });
  it("stays in the menu when another avatar's world is deleted", () => {
    expect(afterDelete(mara, false)).toBe(null);
  });
});
