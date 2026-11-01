import { describe, expect, it } from "vitest";
import { leaveNote } from "../v2/card-game/avatar-menu.mjs";

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
