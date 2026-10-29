import { it } from "vitest";
import assert from "node:assert/strict";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { lemnosReady } from "./helpers/greek-book-three.mjs";

const human = ["vale", "mara", "ash"];
const companion = "greek-lemnos-philoctetes";
const landing = "greek-lemnos-landing";

it("an agreed passenger waits for arrival and keeps the bow", () => {
  const run = dispatchShared;
  const created = run({ op: "create", save: JSON.stringify(lemnosReady()) });
  assert.equal(created.ok, true, created.error);
  let world = created.world;
  world.actors.mara.place = landing;
  world.actors.ash.place = landing;
  const request = (actor) => ({ world, actor, claimed: human, present: human });
  function available(actor, fields) {
    const view = run({ op: "view", ...request(actor) });
    assert.equal(view.ok, true, view.error);
    return view.actions.find((action) =>
      Object.entries(fields).every(([key, value]) => action[key] === value),
    );
  }
  function play(actor, fields) {
    const selected = available(actor, fields);
    assert.ok(
      selected,
      `Missing ${actor} ${JSON.stringify(fields)} at ${world.actors[actor].place}, turn ${world.turn}`,
    );
    const result = run({ op: "play", ...request(actor), action: selected });
    assert.equal(result.ok, true, result.error);
    world = result.world;
    return result;
  }
  function rejectStale(actor, action) {
    assert.ok(action, "The action was offered before the state changed");
    const before = JSON.stringify(world);
    const result = run({ op: "play", ...request(actor), action });
    assert.equal(result.ok, false, "The old action must be rejected");
    assert.deepEqual(
      result.world,
      JSON.parse(before),
      "A rejected action keeps the world unchanged",
    );
  }
  const accompany = (target, destination) => ({
    kind: "accompany",
    target,
    destination,
  });
  const move = (target) => ({ kind: "move", target });
  assert.equal(
    available("vale", { kind: "accompany", target: companion }),
    undefined,
  );
  play("vale", { choiceId: "greek-lemnos-agree-troy" });
  play("vale", { kind: "take", item: "greek-lemnos-water" });
  play("vale", accompany(companion, landing));
  const oldCompanion = available("vale", accompany(companion, "greek-ship"));
  play("mara", move("greek-ship"));
  play("ash", accompany(companion, "greek-ship"));
  assert.equal(world.actors[companion].place, "greek-ship");
  rejectStale("vale", oldCompanion);
  play("vale", move("greek-ship"));
  assert.equal(world.transports["greek-ship"].dock, landing);
  play("mara", move("greek-athens-harbor"));
  play("ash", move("greek-athens-harbor"));
  assert.equal(world.actors[companion].place, "greek-ship");
  assert.equal(
    available("vale", accompany(companion, "greek-ajax-landing")),
    undefined,
  );
  const oldBoard = available("ash", move("greek-ship"));
  play("mara", move("greek-ship"));
  play("mara", move("greek-piraeus"));
  rejectStale("ash", oldBoard);
  assert.equal(world.actors[companion].place, "greek-ship");
  assert.equal(world.items["greek-lemnos-bow"].holder, companion);
  play("mara", move("greek-ship"));
  play("mara", move("greek-ajax-landing"));
  play("vale", accompany(companion, "greek-ajax-landing"));
  assert.equal(
    world.actors.vale.place,
    "greek-ajax-landing",
    "Vale reaches the agreed landing",
  );
  assert.equal(
    world.actors[companion].place,
    "greek-ajax-landing",
    "Philoctetes reaches the agreed landing",
  );
  assert.equal(world.items["greek-lemnos-bow"].holder, companion);
  play("vale", accompany(companion, "greek-greek-camp"));
  assert.equal(world.actors[companion].place, "greek-greek-camp");
  const result = play("vale", { kind: "talk", target: companion });
  const disclosures = result.context.disclosures;
  assert.equal(disclosures[0].factId, "greek-lemnos-arrival-troy");
  assert.equal(
    world.knowledge.known.vale["greek-lemnos-arrival-troy"],
    undefined,
  );
  const speech = run({
    op: "speech",
    ...request("vale"),
    room: "greek-greek-camp",
    disclosures,
    lines: [
      { actorId: "vale", text: "Tell Dione where you have arrived." },
      { actorId: companion, text: disclosures[0].text },
    ],
  });
  assert.equal(speech.ok, true, speech.error);
  world = speech.world;
  assert.equal(
    world.packs["greek-drama"].choices["greek-lemnos-ending"],
    "troy",
  );
  for (const target of ["greek-ajax-landing", "greek-ship", "greek-harbor"])
    play("vale", move(target));
  play("vale", { choiceId: "greek-lemnos-check-manifest" });
  play("vale", move("greek-courtyard"));
  play("vale", { choiceId: "greek-lemnos-return-troy" });
  assert.equal(world.actors[companion].place, "greek-greek-camp");
  assert.equal(world.items["greek-lemnos-bow"].holder, companion);
  assert.equal(world.items["greek-lemnos-water"].holder, "greek-courtyard");
});
