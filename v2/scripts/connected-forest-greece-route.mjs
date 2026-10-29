import assert from "node:assert/strict";
import { exits, itemPlace, rootHolder } from "../card-game/world.mjs";
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
        .filter(([, record]) => Number.isSafeInteger(record.completedTurn))
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
    homecomingTurn: forest.receipts["forest-homecoming-shared"],
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
  assert.equal(
    world.packs[FOREST].choices["forest-homecoming"],
    fixed.homecoming,
  );
}

// This search reads possible local paths. The driver commits each actual move
// through the current legal cards; its input save and server state stay intact.
function localPath(world, actor, goal) {
  const start = world.actors[actor].place;
  const queue = [[start]],
    seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift(),
      here = path.at(-1);
    if (here === goal) return path.slice(1);
    const projected = {
      ...world,
      playerActorId: actor,
      controlledActors: PLAYERS,
      presentActors: PLAYERS,
      actors: {
        ...world.actors,
        [actor]: { ...world.actors[actor], place: here },
      },
    };
    for (const next of exits(projected, here, actor, path.at(-2))) {
      if (next === "greek-ship" || seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

export async function connectedJourney(driver, seed) {
  const fixed = forestContract(seed);
  const protectedItems = new Set(Object.keys(fixed.holders));
  let latest;
  const read = async (actor = "vale") => {
    latest = await driver.read(actor);
    assertForestContract(latest.world, fixed);
    return latest;
  };
  const act = async (actor, fields) => {
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
    assertForestContract(after.world, fixed);
    latest = after;
    return after;
  };
  const move = (actor, target) =>
    act(actor, { kind: "move", target, item: null });
  const travel = async (actor, goal) => {
    for (let turn = 0; turn < 32; turn++) {
      const state = await read(actor);
      if (state.world.actors[actor].place === goal) return;
      const path = localPath(state.world, actor, goal);
      if (path?.length) {
        await move(actor, path[0]);
        continue;
      }
      const remedy = state.actions.find(
        (a) =>
          (a.kind === "light" && a.item === "lamp") ||
          (a.kind === "refill" && a.item === "oil"),
      );
      assert.ok(
        remedy,
        `An actual local route reaches ${goal}: ${JSON.stringify({
          actor,
          place: state.world.actors[actor].place,
          lamp: state.world.items.lamp,
          cloth: state.world.items.cloth,
          moves: state.actions
            .filter((a) => a.kind === "move")
            .map((a) => a.target),
        })}`,
      );
      await act(actor, { kind: remedy.kind, item: remedy.item });
    }
    throw Error(`${actor}'s local route to ${goal} needs attention`);
  };
  const obtain = async (actor, item) => {
    assert.ok(
      !protectedItems.has(item),
      "The forest keeps its sewn belongings",
    );
    for (let attempt = 0; attempt < 8; attempt++) {
      let state = await read(actor);
      if (state.world.items[item].holder === actor) return;
      const owner = rootHolder(state.world, item);
      if (owner === actor) {
        await act(actor, { kind: "take", item });
        continue;
      }
      if (PLAYERS.includes(owner)) {
        await travel(owner, state.world.actors[actor].place);
        await act(owner, { kind: "give", item, target: actor });
      } else {
        await travel(actor, itemPlace(state.world, item));
        state = await read(actor);
        if (itemPlace(state.world, item) !== state.world.actors[actor].place)
          continue;
        let requested = item;
        while (state.world.items[state.world.items[requested].holder])
          requested = state.world.items[requested].holder;
        const take = state.actions.find(
          (a) => a.kind === "take" && a.item === item,
        );
        const ask = state.actions.find(
          (a) => a.kind === "ask" && a.item === requested,
        );
        assert.ok(
          take || ask,
          `${actor} can obtain ${item} through a real resource action`,
        );
        await act(actor, {
          kind: (take || ask).kind,
          item: (take || ask).item,
        });
      }
      state = await read(actor);
      if (state.world.items[item].holder === actor) return;
      if (rootHolder(state.world, item) === actor) continue;
      const trade = state.actions.find(
        (a) =>
          a.kind === "trade" &&
          a.receive === item &&
          !protectedItems.has(a.item),
      );
      assert.ok(trade, `${item}'s holder must agree to its actual transfer`);
      await act(actor, {
        kind: "trade",
        item: trade.item,
        receive: item,
        target: trade.target,
      });
    }
    throw Error(`${actor} needs an agreed transfer of ${item}`);
  };
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
  const stage = async (label) => {
    await read();
    await driver.checkpoint?.(label, latest.world);
  };

  let state = await read("mara");
  const home = humanAvatar("mara");
  assert.equal(state.world.actors.mara.place, home.home.id);
  assert.equal(state.world.items[home.item.id].holder, home.home.id);
  await stage("shared-import-and-real-home");
  await act("mara", { kind: "take", item: home.item.id });
  state = await read("mara");
  if (state.actions.some((a) => a.kind === "use" && a.item === home.item.id))
    await act("mara", { kind: "use", item: home.item.id });
  await move("mara", "pond");
  await act("mara", { kind: "drop", item: home.item.id, target: "pond" });

  await travel("vale", "pond");
  // Borrow, carry, tend and flash the original physical lamp and cloth.
  await obtain("mara", "lamp");
  state = await read("mara");
  if (state.world.items.lamp.fuel < 8) {
    await travel("mara", itemPlace(state.world, "oil"));
    state = await read("mara");
    if (!state.actions.some((a) => a.kind === "refill" && a.item === "oil"))
      await obtain("mara", "oil");
    for (let count = 0; count < 4; count++) {
      state = await read("mara");
      if (state.world.items.lamp.fuel >= 8) break;
      await act("mara", { kind: "refill", item: "oil" });
    }
    state = await read("mara");
    if (state.world.items.oil.holder === "mara")
      await act("mara", {
        kind: "drop",
        item: "oil",
        target: state.world.actors.mara.place,
      });
  }
  await obtain("mara", "cloth");
  await travel("mara", "pond");
  state = await read("mara");
  if (state.world.items.bell.holder === "mara")
    await act("mara", { kind: "drop", item: "bell", target: "pond" });
  await travel("vale", "pond");
  state = await read("mara");
  if (!state.world.items.lamp.lit)
    await act("mara", { kind: "light", item: "lamp" });
  for (
    let count = 0;
    count < 4 && (await read("mara")).world.items.bell.ringing;
    count++
  )
    await act("mara", { kind: "wait" });
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
  await move("vale", "greek-harbor");
  state = await read("mara");
  assert.ok(
    !state.actions.some((a) => a.kind === "move" && a.target === "pond"),
  );
  await move("mara", "greek-harbor");
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
  await move("vale", "pond");
  await move("mara", "pond");
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
