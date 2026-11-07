import { expect, it } from "vitest";
import { narrativeContractCases, playCard } from "./fixtures/card-narrative-contexts.mjs";
import { narrativeContext, turnOutcome } from "../v2/card-game/narrative.mjs";
import { forgetCovered } from "../v2/card-game/speech-knowledge.mjs";
import { encodeSave, decodeSave, nameOf } from "../v2/card-game/world.mjs";
import { seatActors } from "../v2/card-game/human-cast.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";
import { knownActors } from "../v2/card-game/want.mjs";

it("keeps a received hand through Talk/reload and each speaker's private inventory", () => {
  let world = narrativeContractCases().find((c) => c.name === "accepted give").world;
  for (const phase of ["give", "talk", "reload"]) {
    if (phase === "talk") world = playCard(world, "talk", null, "moth");
    if (phase === "reload") world = decodeSave(encodeSave(world));
    const context = narrativeContext(world);
    expect(context.outcome.avatars.find((a) => a.id === "moth").heldItem).toBe("lamp");
    const items = (id) => context.entities.find((e) => e.id === id).facts.find((f) => f.startsWith("At the dialogue scene:"));
    expect(items("moth")).not.toContain(nameOf("cloth"));
    expect(items("vale")).toContain(nameOf("cloth"));
    const hidden = forgetCovered(world, context, (id) => id === "lamp");
    expect(hidden.outcome.avatars.find((a) => a.id === "moth").heldItem).toBeNull();
  }
  world.actors.moth.want = {kind: "item", target: "cloth", since: world.turn, refusals: 0};
  const wanting = narrativeContext(world).entities.find((e) => e.id === "moth").facts.join(" ");
  expect(wanting).not.toContain(`Wants ${nameOf("cloth")}, currently with`);
});

it("keeps chosen hands within the item cap after the committed action item", () => {
  let world = narrativeContractCases().find((c) => c.name === "Theban report").world;
  world.packs["greek-drama"].scope = "full";
  world.sharedVersion = 1;
  world = seatActors(world, ["vale", "mara"], ["vale", "mara"]);
  const actors = knownActors(world).slice(0, 8), here = world.actors.vale.place;
  for (const id of actors) world.actors[id].place = here;
  const items = Object.keys(world.items).filter((id) => id !== "greek-shovel" && entityActive(world, id)).slice(0, 24);
  expect(actors).toHaveLength(8);
  expect(items).toHaveLength(24);
  for (const [i, item] of items.entries()) world.items[item].holder = actors[Math.floor(i / 3)];
  for (const [i, id] of actors.entries()) world.actors[id].heldItem = items[i * 3 + 2];
  const outcome = turnOutcome(world);
  expect(outcome.items).toHaveLength(24);
  expect(outcome.items[0].id).toBe("greek-shovel");
  for (const actor of outcome.avatars)
    expect(outcome.items).toContainEqual({id: actor.heldItem, holder: actor.id, location: here});
});
