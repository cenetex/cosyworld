import { describe, expect, it } from "vitest";
import {
  joinable,
  leaveNote,
  worldSeats,
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
    expect(seats.map((s) => s.kind)).toEqual([
      "you",
      "human",
      "away",
      "open",
      "open",
      "open",
      "open",
      "open",
    ]);
    expect(seats.map((s) => s.id)).toEqual(humanAvatars.map((a) => a.id));
    expect(seats[0].holder).toBe("You");
    expect(seats[1].holder).toBe("Amber Heron");
    expect(seats[3].holder).toBe("");
  });
  it("lets the owner free every held seat but their own", () => {
    expect(
      worldSeats(state)
        .filter((s) => s.free)
        .map((s) => s.id),
    ).toEqual([humanAvatars[1].id, humanAvatars[2].id]);
    expect(worldSeats({ ...state, owner: false }).some((s) => s.free)).toBe(
      false,
    );
  });
  it("shows no Table outside a shared seat", () => {
    expect(worldSeats(null)).toEqual([]);
    expect(worldSeats({ ...state, actor: null })).toEqual([]);
  });
});
