// Shared worlds stored at rules 67 (release 1.2.111) asked for a fresh start
// under rules 75-77, so the shared server answered 409 (2026-11-01). The
// fixture is a generated rules-67 world, with no player data, that met each
// gap: the Theban refusal had opened the Open Door, Oak's night watch was
// reworded (#1747) and a sea lane was told.
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "./fixtures/shared-world-rules-67-refusal.json.gz",
        import.meta.url,
      ),
    ),
  ),
);
const greek = packDefinitions.find((p) => p.id === "greek-drama");
const context = (actor = "vale") => ({
  actor,
  claimed: fixture.avatars,
  present: fixture.avatars,
});
const upgrade = () =>
  dispatchShared({
    op: "upgrade",
    from: fixture.version,
    to: "full-card-world/78",
    seed: 12345,
    world: structuredClone(fixture.world),
    ...context(),
  });


describe("a save that named the retired storybook map", () => {
  const withMap = (change) => {
    const s = JSON.parse(encodeSave(createWorld()));
    s.items["world-map"] = { holder: "vale", history: [] };
    s.memories["world-map"] = structuredClone(s.memories.bell);
    change(s);
    return decodeSave(JSON.stringify(s));
  };
  it("lets go of a keepsake, an experience and a wish for it", () => {
    const loaded = withMap((s) => {
      s.life.actors.moth.attachments["world-map"] = { from: "vale", turn: 0 };
      s.life.actors.moth.experiences.push({
        kind: "gift",
        turn: 0,
        other: "vale",
        item: "world-map",
        place: "station",
      });
      s.actors.keeper.want = {
        kind: "item",
        target: "world-map",
        since: 0,
        refusals: 0,
      };
    });
    expect(loaded.life.actors.moth.attachments["world-map"]).toBeUndefined();
    expect(loaded.life.actors.moth.experiences.at(-1).item).toBeNull();
    expect(loaded.actors.keeper.want?.target).not.toBe("world-map");
  });
});


describe("a refused shared save", () => {
  // package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("names where the rules refused it, and nothing of the world", async () => {
    await import("../v2/card-game/shared-world-entry.mjs");
    const world = structuredClone(fixture.world);
    world.items.lamp.holder = "nowhere";
    const reply = JSON.parse(
      globalThis.cardShared(
        JSON.stringify({ op: "validate", world, ...context() }),
      ),
    );
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(
      /^This save needs a fresh start\..*\(validateWorld:\d+ < decodeSave:\d+/,
    );
    expect(reply.error).not.toMatch(/nowhere|lamp/);
  });
});
