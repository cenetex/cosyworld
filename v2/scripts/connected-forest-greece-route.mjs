import assert from "node:assert/strict";
import { humanAvatar } from "../card-game/human-cast.mjs";

const FOREST = "lonely-forest";
const PERSONAL = "forest-rati-scarf";
export const PLAYERS = ["vale", "mara"];
const matches = (action, fields) =>
  Object.entries(fields).every(([key, value]) => action[key] === value);

export function forestContract(seed) {
  assert.equal(
    seed.actors.vale.place,
    "attic",
    "The forest UI ends in the attic",
  );
  const forest = seed.packs[FOREST];
  for (const key of [
    `${FOREST}:forest-rati-scarf:vale`,
    `${FOREST}:story-quest-forest-path`,
    `${FOREST}:story-quest-forest-homecoming`,
    `${FOREST}:story-quest-forest-personal-hearth`,
  ])
    assert.ok(
      Number.isSafeInteger(seed.quests.records[key]?.completedTurn),
      `${key} is complete in the forest save`,
    );
  assert.equal(forest.flags["forest-homecoming-shared"], true);
  const personal = forest.personalQuests[PERSONAL].records.vale;
  assert.ok(Number.isSafeInteger(personal.reward.awardedTurn));
  assert.ok(Number.isSafeInteger(personal.button.consumedTurn));
  assert.equal(seed.items[personal.reward.id].holder, "vale");
  assert.equal(seed.items[personal.button.id].holder, personal.reward.id);
  return structuredClone({
    personal,
    holders: Object.fromEntries(
      [personal.button.id, personal.reward.id].map((id) => [
        id,
        seed.items[id].holder,
      ]),
    ),
    completed: Object.fromEntries(
      Object.entries(seed.quests.records)
        .filter(
          ([key, record]) =>
            key.startsWith(`${FOREST}:`) &&
            Number.isSafeInteger(record.completedTurn),
        )
        .map(([key, record]) => [
          key,
          {
            completedTurn: record.completedTurn,
            completion: record.completion,
            program: record.program,
          },
        ]),
    ),
    homecoming: forest.choices["forest-homecoming"],
    receipts: forest.receipts,
  });
}

export function assertForestContract(world, fixed) {
  assert.deepEqual(
    world.packs[FOREST].personalQuests[PERSONAL].records.vale,
    fixed.personal,
  );
  for (const [id, holder] of Object.entries(fixed.holders))
    assert.equal(
      world.items[id].holder,
      holder,
      `${id} keeps its physical custody`,
    );
  for (const [key, expected] of Object.entries(fixed.completed)) {
    const actual = world.quests.records[key];
    assert.ok(actual, `The earlier quest ${key} remains saved`);
    assert.deepEqual(
      {
        completedTurn: actual.completedTurn,
        completion: actual.completion,
        program: actual.program,
      },
      expected,
      `${key} keeps its original completion`,
    );
  }
  for (const [choice, turn] of Object.entries(fixed.receipts))
    assert.equal(
      world.packs[FOREST].receipts[choice],
      turn,
      `${choice} keeps its original turn`,
    );
  assert.equal(
    world.packs[FOREST].choices["forest-homecoming"],
    fixed.homecoming,
  );
}

export async function connectedJourney(driver, seed) {
  const fixed = forestContract(seed);
  const traveler = fixed.homecoming === "traveler";
  let latest;
  const read = async (actor = "vale") => {
    latest = await driver.read(actor);
    assertForestContract(latest.world, fixed);
    return latest;
  };
  const act = async (actor, fields, { travelAccepted = true } = {}) => {
    const before = await read(actor);
    const action = before.actions.find((entry) => matches(entry, fields));
    assert.ok(
      action,
      `${actor} has ${JSON.stringify(fields)} at ${before.world.actors[actor].place}`,
    );
    const after = await driver.play(actor, action, before);
    assert.equal(
      after.world.turn,
      before.world.turn + 1,
      "One accepted play advances one turn",
    );
    if (fields.kind === "move")
      assert.equal(after.world.actors[actor].place, fields.target);
    if (fields.kind === "accompany") {
      for (const member of [actor, fields.target])
        assert.equal(
          after.world.actors[member].place,
          travelAccepted
            ? fields.destination
            : before.world.actors[member].place,
          travelAccepted
            ? "The agreed party travels together"
            : "The invitation keeps its refusal",
        );
    }
    if (["take", "trade"].includes(fields.kind))
      assert.equal(
        after.world.items[fields.receive || fields.item].holder,
        actor,
      );
    if (["give", "trade"].includes(fields.kind))
      assert.equal(after.world.items[fields.item].holder, fields.target);
    assertForestContract(after.world, fixed);
    latest = after;
    return after;
  };
  const move = (actor, target) =>
    act(actor, { kind: "move", target, item: null });
  const board = async (actor) => {
    for (let turn = 0; turn < 24; turn++) {
      const state = await read(actor);
      if (
        state.actions.some(
          (a) => a.kind === "move" && a.target === "greek-ship",
        )
      ) {
        await move(actor, "greek-ship");
        return;
      }
      await act(actor, { kind: "wait" });
    }
    throw Error(`The shared ship needs to reach ${actor}'s actual shore`);
  };
  const landTogether = async (target) => {
    await move("vale", target);
    const state = await read("mara");
    assert.equal(state.world.transports["greek-ship"].dock, target);
    assert.equal(state.world.actors.mara.place, "greek-ship");
    assert.ok(
      state.actions.some(
        (action) =>
          action.kind === "move" &&
          action.target === target &&
          action.item === null,
      ),
      `Mara can finish landing at ${target} after Vale; ship ${JSON.stringify(state.world.transports["greek-ship"])}`,
    );
    await move("mara", target);
  };
  const stage = async (label) => {
    await read();
    await driver.checkpoint?.(label, latest.world);
  };

  let state = await read("mara");
  const home = humanAvatar("mara");
  assert.equal(state.world.actors.mara.place, home.home.id);
  assert.equal(state.world.items[home.item.id].holder, home.home.id);
  await stage("shared-import-and-real-home");
  if (traveler) await act("vale", { kind: "wait" });
  await act("mara", { kind: "take", item: home.item.id });
  await move("mara", "pond");
  await act("mara", { kind: "drop", item: home.item.id, target: "pond" });

  await move("vale", "pond");
  await stage("quiet-shore-company");

  // Prepare the signal through the cast's trades, gifts, and agreed requests.
  await act("mara", { kind: "take", item: home.item.id });
  await move("mara", "station");
  if (traveler) await act("mara", { kind: "refill", item: "oil" });
  await act("mara", { kind: "ask", item: "oil", target: "moth" });
  assert.equal((await read()).world.items.oil.holder, "mara");
  await move("mara", "pond");
  if (traveler) {
    await move("vale", "station");
    await act("vale", { kind: "light", item: "lamp" });
    const invitation = {
      kind: "accompany",
      target: "keeper",
      destination: "pond",
    };
    await act("vale", invitation, { travelAccepted: false });
    await act("vale", invitation);
  } else await move("mara", "station");
  await act("mara", {
    kind: "trade",
    item: "oil",
    receive: "lamp",
    target: "keeper",
  });
  await act("mara", { kind: "refill", item: "oil" });
  await act("mara", { kind: "ask", item: "oil", target: "keeper" });
  assert.equal((await read()).world.items.oil.holder, "mara");
  await act("mara", { kind: "give", item: "lamp", target: "keeper" });
  await act("mara", { kind: "ask", item: "cloth", target: "keeper" });
  state = await read();
  assert.equal(state.world.items.cloth.holder, "mara");
  assert.equal(state.world.items.bell.holder, "keeper");
  await stage("agreed-cloth-transfer");
  await act("mara", {
    kind: "drop",
    item: home.item.id,
    target: state.world.actors.mara.place,
  });
  if (!traveler) {
    await act("mara", { kind: "ask", item: "lamp", target: "keeper" });
    assert.equal(
      (await read()).world.items.lamp.holder,
      "keeper",
      "The keeper keeps his gift until an agreed trade",
    );
    await act("mara", {
      kind: "accompany",
      target: "keeper",
      destination: "pond",
    });
    await act("mara", { kind: "wait" });
  }
  await act("mara", {
    kind: "trade",
    item: "oil",
    receive: "lamp",
    target: "keeper",
  });
  await act("mara", { kind: "refill", item: "oil" });
  await act("mara", { kind: "refill", item: "oil" });
  if (traveler) await act("mara", { kind: "light", item: "lamp" });
  state = await read();
  assert.equal(state.world.items.lamp.lit, true);
  assert.ok(
    state.world.items.lamp.fuel >= 5,
    "The lamp has fuel for four signal plays",
  );
  for (let flash = 0; flash < 2; flash++) {
    await act("mara", { kind: "cover", item: "cloth", target: "lamp" });
    await act("mara", { kind: "take", item: "cloth" });
  }
  state = await read();
  assert.equal(state.world.crossings["pond-greek-harbor"].discovered, true);
  await stage("real-lamp-signal");
  await board("vale");
  await board("mara");
  await stage("two-humans-aboard");
  await driver.reload?.("mara");
  await landTogether("greek-harbor");
  await stage("shared-greek-arrival");
  for (const actor of PLAYERS) {
    await move(actor, "greek-courtyard");
    await move(actor, "greek-well");
  }
  await act("mara", { kind: "take", item: "greek-water-jar" });
  state = await read();
  assert.equal(state.world.items["greek-water-jar"].holder, "mara");
  await stage("physical-water-jar");
  for (const actor of PLAYERS) await move(actor, "greek-courtyard");
  await act("mara", { kind: "choose", choiceId: "greek-return-water-jar" });
  state = await read();
  assert.equal(state.world.items["greek-water-jar"].holder, "greek-courtyard");
  assert.equal(
    state.world.packs["greek-drama"].flags["greek-water-returned"],
    true,
  );
  await stage("dione-water-return");
  for (const actor of PLAYERS) await move(actor, "greek-harbor");
  for (const actor of PLAYERS) await board(actor);
  await landTogether("pond");
  for (const actor of PLAYERS) await driver.reload?.(actor);
  await stage("shared-forest-return");
  state = await read();
  return {
    fixed,
    world: state.world,
    waterReturn: {
      actor: "mara",
      holder: state.world.items["greek-water-jar"].holder,
      turn: state.world.packs["greek-drama"].receipts["greek-return-water-jar"],
    },
  };
}
