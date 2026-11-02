import { describe, expect, it } from "vitest";
import { hiddenFor, unlockedSince } from "../v2/card-game/unlock-view.mjs";

const world = (met = []) => ({
  hidden: { actor: "mara", place: "forest-garden", met },
  log: [
    { seq: 4, text: "Vale asks Mara what they want." },
    ...(met.length ? [{ seq: 5, unlock: "mara", actorId: "vale" }] : []),
  ],
});

describe("the hidden avatar on the table (#1936)", () => {
  it("names the avatar still to find until this avatar meets it", () => {
    expect(hiddenFor(world(), "vale")?.name).toBe("Mara");
    expect(hiddenFor(world(["vale"]), "vale")).toBeNull();
    // Found already by this passkey, or nobody hidden: nothing to find.
    expect(hiddenFor(world(), "vale", ["vale", "mara"])).toBeNull();
    expect(hiddenFor({}, "vale")).toBeNull();
  });
  it("finds the unlock this avatar's Talk committed since a point", () => {
    expect(unlockedSince(world(["vale"]), "vale", 4)?.name).toBe("Mara");
    expect(unlockedSince(world(["vale"]), "vale", 5)).toBeNull();
    expect(unlockedSince(world(["vale"]), "ash", 4)).toBeNull();
  });
});
