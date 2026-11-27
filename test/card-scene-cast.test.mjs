import { expect, it } from "vitest";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { sceneChanges as stagedChanges } from "../v2/card-game/scene.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { addLog, createWorld } from "../v2/card-game/world.mjs";
import { profiles } from "../v2/card-game/memory.mjs";
import {
  dialogueCast,
  sceneChanges,
  speechMemories,
} from "../v2/card-game/scene-cast.mjs";

// scene-cast.mjs is the rules half of narrative.mjs and scene.mjs: who is in
// a scene and who speaks. Until the shared engine switches to it, it must
// agree with the originals exactly (docs/design/pack-content-outside-the-engine.md).
const shared = { claimed: ["vale"], present: ["vale"] };

it("keeps saved Void identity proof separate from remembered and quoted speech", () => {
  const resident = "elysium-claude", room = "elysium-void-002";
  const world = createWorld({ seed: 440 });
  world.actors.vale.place = room;
  world.actors[resident].place = room;
  world.packs.elysium.met = { [resident]: 1 };
  const name = "Amber Thread";
  const natural = "The leaves are quiet tonight.";
  const introduction = `I call myself ${name}. My token has slipped into the world beyond this Void.`;
  const waiting = "My name is still taking shape. Ask me again, traveler.";
  world.turn = 1;
  for (const text of [natural, introduction, waiting])
    addLog(world, profiles[resident].name, text, {
      kind: "dialogue", actorId: resident, entityId: resident, generated: true,
      locationId: room, cast: ["vale", resident],
      ...(text === introduction && { elysiumName: name }),
    });
  world.turn = 2;
  world.memories[resident].text = waiting;
  addLog(world, "Vale", "Vale talks with a Void resident.", {
    kind: "action", verb: "talk", actorId: "vale", targetId: resident,
    locationId: room, fromLocationId: room, cast: ["vale", resident],
  });
  const context = narrativeContext(world, { kind: "talk", target: resident });
  const speaker = context.entities.find((entity) => entity.id === resident);
  expect(context.conversation.map((line) => line.text)).toEqual([natural, introduction]);
  expect(context.conversation[1].elysiumName).toBe(name);
  expect(speaker.previous).toBeNull();
  expect(speaker.memories.filter((event) => event.kind === "expression").map((event) => event.text))
    .toEqual([`${profiles[resident].name}: ${natural}`]);
  expect(speaker.between[0].said.map((line) => line.text)).toEqual([natural]);
  expect(world.log.filter((line) => line.generated).map((line) => line.text))
    .toEqual([natural, introduction, waiting]);
});

function* scenes() {
  let world = dispatchShared({ op: "create" }).world;
  // Quietly stow the opening lamp so the sampled plays can leave the attic.
  world = dispatchShared({ op: "hold", world, actor: "vale", ...shared,
    choice: { item: null, revision: world.revision } }).world;
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
