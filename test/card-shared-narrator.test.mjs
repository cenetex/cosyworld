import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { sharedContext } from "../v2/card-game/shared-narrator.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";
import { decodeSave, nameOf } from "../v2/card-game/world.mjs";

// Rust asks the narrator bundle for a committed play's dialogue context; the
// rules engine no longer builds it (docs/design/pack-content-outside-the-engine.md).
// The bundle must describe the scene exactly as the browser narrative does.
const source = readFileSync(
  new URL(
    "../v2/orchestrator-rust/src/card_shared/narrator.js",
    import.meta.url,
  ),
  "utf8",
);
const sandbox = {};
runInNewContext(source, sandbox);
const narrate = (request) =>
  JSON.parse(sandbox.cardNarrator(JSON.stringify(request)));
const context = { claimed: ["vale"], present: ["vale"] };

it("gives the browser narrative's context for each committed scene", () => {
  let world = dispatchShared({ op: "create" }).world;
  let compared = 0;
  for (let step = 0; step < 12; step++) {
    const options = dispatchShared({
      op: "view",
      world,
      actor: "vale",
      ...context,
    }).actions;
    // Walk varied plays; skip one the rules refuse and try the next.
    let action, played;
    for (let i = 0; !played?.ok && i < options.length; i++) {
      action = options[(step * 7 + i) % options.length];
      try {
        played = dispatchShared({
          op: "play",
          world,
          actor: "vale",
          action,
          ...context,
        });
      } catch {
        played = null;
      }
    }
    expect(played.ok).toBe(true);
    world = played.world;
    expect(played.context).toBeUndefined();
    const scene = { world, actor: "vale", action, ...context };
    const told = narrate(scene);
    expect(told.ok).toBe(true);
    expect(told.context).toEqual(sharedContext(scene));
    expect(told.context).toEqual(
      narrativeContext(
        {
          ...world,
          playerActorId: "vale",
          controlledActors: ["vale"],
          presentActors: ["vale"],
        },
        action,
      ),
    );
    compared++;
  }
  expect(compared).toBe(12);
});

it("reports a bad request instead of throwing into the host", () => {
  const told = narrate({ actor: "vale" });
  expect(told.ok).toBe(false);
  expect(typeof told.error).toBe("string");
  expect(humanAvatarIds).toContain("vale");
});

it("gives a resident its own want in the game's words, and nothing without one", () => {
  const world = dispatchShared({ op: "create" }).world;
  world.actors.vale.place = world.actors.moth.place;
  world.actors.moth.trust.vale = 2;
  const told = narrate({ world, own: ["moth", "keeper", "vale"] });
  const game = decodeSave(JSON.stringify(world));
  expect(told.own.moth[0]).toBe(wantFact(game, "moth", nameOf, "vale"));
  expect(told.own.moth).toEqual([
    "I want the Lamp.",
    "Owes a favour to Vale; willing to share a spare or take a detour with them.",
  ]);
  expect(told.own.keeper).toEqual([wantFact(game, "keeper", nameOf, "vale")]);
  expect(told.own.vale).toEqual([]);
});
