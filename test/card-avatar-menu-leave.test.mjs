import { describe, expect, it } from "vitest";
import {
  joinable,
  leaveNote,
  ownedSeats,
} from "../v2/card-game/avatar-menu.mjs";
import { humanAvatars } from "../v2/card-game/human-cast.mjs";

const mara = { id: "mara", name: "Mara" };

describe("leaving a world", () => {
  it("warns that a local world and its progress are lost for good", () => {
    expect(leaveNote(mara, { local: true, name: "Hollowmere" })).toBe(
      "Hollowmere will be lost, with Mara's level and quest there. There is no way back to it.",
    );
  });
  it("keeps a shared world's things for the avatar's return", () => {
    expect(leaveNote(mara, { shared: "w1", name: "The Quiet Ferry" })).toBe(
      "The Quiet Ferry keeps Mara's things.",
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

describe("the owner's delete (#1825)", () => {
  it("lists each avatar taken in the world, for the owner only", () => {
    const bound = [1, 0, 1, 0, 0, 0, 0, 0];
    expect(ownedSeats({ owner: true, bound }).map((a) => a.id)).toEqual([
      humanAvatars[0].id,
      humanAvatars[2].id,
    ]);
    expect(ownedSeats({ owner: false, bound })).toEqual([]);
    expect(ownedSeats(null)).toEqual([]);
  });
});
