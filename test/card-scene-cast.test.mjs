import { expect, it } from "vitest";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { sceneChanges as stagedChanges } from "../v2/card-game/scene.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  dialogueCast,
  sceneChanges,
  speechMemories,
} from "../v2/card-game/scene-cast.mjs";

// scene-cast.mjs is the rules half of narrative.mjs and scene.mjs: who is in
// a scene and who speaks. Until the shared engine switches to it, it must
// agree with the originals exactly (docs/design/pack-content-outside-the-engine.md).
const shared = { claimed: ["vale"], present: ["vale"] };
function* scenes() {
  let world = dispatchShared({ op: "create" }).world;
  for (let step = 0; step < 24; step++) {
    const options = dispatchShared({
      op: "view",
      world,
      actor: "vale",
      ...shared,
    }).actions;
    let action, played;
    for (let i = 0; !played?.ok && i < options.length; i++) {
      action = options[(step * 7 + i) % options.length];
      try {
        played = dispatchShared({
          op: "play",
          world,
          actor: "vale",
          action,
          ...shared,
        });
      } catch {
        played = null;
      }
    }
    world = played.world;
    yield { world: { ...world, playerActorId: "vale", ...shared }, action };
  }
}

it("selects the same cast, speakers and remembered events as the narrative", () => {
  let talks = 0;
  for (const { world, action } of scenes()) {
    const told = narrativeContext(world, action);
    const cast = dialogueCast(world, action);
    expect(cast.location).toBe(told.location);
    // The narrative voices only the play's speech occasions, from this cast.
    for (const id of told.speakers) expect(cast.ids).toContain(id);
    expect(told.focus).toBeNull();
    expect([null, cast.resting]).toContain(told.resting);
    expect(cast.ids).toEqual(told.entities.map((e) => e.id));
    expect(sceneChanges(world)).toEqual(stagedChanges(world));
    expect(
      cast.ids.map((id) =>
        speechMemories(world.memories[id], {
          expressions: !cast.beforeFirstLight,
        }),
      ),
    ).toEqual(told.entities.map((e) => e.memories));
    if (told.speakers.length > 1) talks++;
  }
  expect(talks).toBeGreaterThan(0);
});
