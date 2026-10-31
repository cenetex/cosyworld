import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";

// Rust asks the narrator bundle for a committed play's dialogue context
// instead of the rules engine (docs/design/pack-content-outside-the-engine.md).
// It must describe the scene exactly as the play itself did.
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

it("gives the same dialogue context as the play that committed the scene", () => {
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
    const told = narrate({ world, actor: "vale", action, ...context });
    expect(told.ok).toBe(true);
    expect(told.context).toEqual(played.context);
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
