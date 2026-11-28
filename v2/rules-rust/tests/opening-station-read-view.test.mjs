import assert from "node:assert/strict";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { currentSharedEngine } from "../../../test/fixtures/shared-engine.mjs";
import { reducers } from "./parity.mjs";

const seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
const keeperQuest = "accept:vale::keeper";
const abandon = "drop:vale:::0";
const abandonOp = "opening_keeper_abandon";
const giftOp = "opening_keeper_abandon_gift";
const replyOp = "opening_keeper_abandon_reply";

function traceKeeperAbandon(source) {
  const loop = "    for (const id of residents2) {";
  const action =
    "      perform(next, read2 ?? plan(next, id).action, round2, residents2);";
  for (const marker of [loop, action])
    assert.equal(source.split(marker).length, 2);
  return source
    .replace(
      loop,
      `    if (next.turn === 4 && next.actors.vale.gaveUp?.target === "pond")
      globalThis.abandonPhase = structuredClone(next);
${loop}`,
    )
    .replace(
      action,
      `      const chosen = read2 ?? plan(next, id).action;
      const gift = next.turn === 4 && next.actors.vale.gaveUp?.target === "pond" && id === "moth";
      if (gift) globalThis.pipAction = chosen.key;
      perform(next, chosen, round2, residents2);
      if (gift) globalThis.giftPhase = structuredClone(next);`,
    );
}

test("Keeper Log reading, abandonment, Pip’s gift, and reload match pinned states", async () => {
  const { pinned, wasm } = await reducers();
  const reference = currentSharedEngine(traceKeeperAbandon);
  const run = (request) => {
    const reply = pinned(request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  };
  const play = (world, action) =>
    run({ ...seats, op: "play", world, action }).world;
  let sample;
  let acceptance;
  let accepted;
  for (const [seed, dry, spoken, sorted] of [
    [undefined, false, false, false],
    [0, true, false, true],
    [2, false, true, false],
    [42, true, true, true],
    [4242, false, false, true],
    [4_294_967_295, true, false, false],
  ]) {
    let { world } = run({ op: "create", seed });
    if (dry) {
      Object.assign(world.items.lamp, { fuel: 0, fuelRooms: 0, lit: false });
    } else {
      ({ world } = run({
        ...seats,
        op: "hold",
        world,
        choice: { item: null, revision: world.revision },
      }));
    }
    world = play(play(world, "move:vale::pond"), "move:vale::station");
    if (spoken) {
      ({ world } = run({
        ...seats,
        op: "speech",
        world,
        room: "station",
        lines: [{ actorId: "keeper", text: "The platform is quiet." }],
      }));
    }
    if (sorted)
      world.actors = Object.fromEntries(
        Object.entries(world.actors).toSorted(),
      );
    const key = "read:vale:keeper-log:";
    const read = {
      ...seats,
      op: "play",
      world,
      action: sorted ? { key } : key,
    };
    const expectedRead = run(read);
    const actualRead = wasm(read);
    const differing = Object.keys(expectedRead.world).find(
      (field) =>
        !isDeepStrictEqual(actualRead?.world[field], expectedRead.world[field]),
    );
    assert.ok(
      isDeepStrictEqual(actualRead, expectedRead),
      `read ${seed} ${differing}`,
    );
    assert.deepEqual(
      actualRead.events.map(({ verb }) => verb),
      ["read", "wait"],
    );
    assert.equal(wasm({ ...read, revision: world.revision - 1 }), null);
    world = actualRead.world;
    assert.equal(wasm({ ...read, world }), null);
    for (const present of [["vale"], []]) {
      const request = { ...seats, op: "view", world, present };
      const expected = run(request);
      const actual = wasm(request);
      assert.ok(isDeepStrictEqual(actual, expected), `${seed}/${present}`);
      const train = actual.actions.findIndex(
        ({ key }) => key === "accept:vale::box:train",
      );
      assert.equal(actual.actions[train - 1].key, "accept:vale::keeper");
      assert.deepEqual(actual.world.speechVoices.vale, []);
      sample = request;
    }
    acceptance = {
      ...read,
      world: expectedRead.world,
      action: sorted ? { key: keeperQuest } : keeperQuest,
      revision: world.revision,
    };
    const acceptedPinned = run(acceptance);
    accepted = wasm(acceptance);
    assert.ok(isDeepStrictEqual(accepted, acceptedPinned), `accept ${seed}`);
    assert.deepEqual(accepted.events, []);
    assert.equal(accepted.world.eventSeq, world.eventSeq);
    assert.equal(accepted.world.turn, world.turn);
    assert.equal(accepted.world.revision, world.revision + 1);
    assert.equal(accepted.world.actors.vale.want.from, "quest:from:keeper");
    assert.equal(accepted.actions.at(-1).key, "drop:vale:::0");
    for (const present of [["vale"], []]) {
      const request = {
        ...seats,
        op: "view",
        world: structuredClone(accepted.world),
        present,
      };
      assert.ok(
        isDeepStrictEqual(wasm(request), run(request)),
        `accepted ${seed}/${present}`,
      );
    }

    const drop = {
      ...seats,
      op: "play",
      world: acceptedPinned.world,
      action: sorted ? { key: abandon } : abandon,
    };
    const fullDrop = JSON.parse(reference.cardShared(JSON.stringify(drop)));
    assert.equal(fullDrop.ok, true, fullDrop.error);
    assert.equal(reference.pipAction, "give:moth:cloth:vale");
    assert.deepEqual(
      fullDrop.events.map(({ actorId, verb }) => [actorId, verb]),
      [
        ["vale", "drop"],
        ["moth", "give"],
      ],
    );
    const stage = JSON.parse(JSON.stringify(reference.abandonPhase));
    const probe = { ...drop, op: abandonOp, revision: drop.world.revision };
    const primary = wasm(probe);
    const different = Object.keys(stage).find(
      (key) => !isDeepStrictEqual(stage[key], primary?.world[key]),
    );
    assert.ok(
      isDeepStrictEqual(primary, { ok: true, world: stage }),
      `drop stage ${seed} ${different ?? ""}`,
    );
    assert.deepEqual(primary.world.log.at(-1), fullDrop.events[0]);
    assert.equal(primary.world.items.cloth.holder, "moth");
    assert.equal(fullDrop.world.items.cloth.holder, "vale");
    const expectedGift = JSON.parse(JSON.stringify(reference.giftPhase));
    const giving = { op: giftOp, world: stage };
    const gift = wasm(giving);
    const giftDifference = Object.keys(expectedGift).find(
      (key) => !isDeepStrictEqual(expectedGift[key], gift?.world[key]),
    );
    assert.ok(
      isDeepStrictEqual(gift, { ok: true, world: expectedGift }),
      `gift stage ${seed} ${giftDifference ?? ""}`,
    );
    assert.deepEqual(gift.world.log.at(-1), fullDrop.events[1]);
    assert.equal(gift.world.actors.vale.heldItem, "cloth");
    assert.equal(gift.world.memories.moth.learning.at(-1).reward, -5);
    assert.equal(wasm({ ...giving, world: gift.world }), null);
    const complete = {
      ...seats,
      op: replyOp,
      beforeSeq: drop.world.eventSeq,
      world: { ...fullDrop.world, speechVoices: gift.world.speechVoices },
    };
    const reply = wasm(complete);
    assert.ok(isDeepStrictEqual(reply, fullDrop), `drop reply ${seed}`);
    assert.deepEqual(reply.world.speechVoices.vale, ["vale"]);
    assert.equal(
      wasm({ ...complete, beforeSeq: complete.beforeSeq - 1 }),
      null,
    );
    assert.equal(wasm({ ...complete, present: [] }), null);
    assert.equal(wasm({ ...complete, world: stage }), null);
    const played = wasm(drop);
    const changedField = Object.keys(fullDrop.world).find(
      (key) => !isDeepStrictEqual(played?.world[key], fullDrop.world[key]),
    );
    assert.ok(
      isDeepStrictEqual(played, fullDrop),
      `normal drop ${seed} ${changedField ?? ""}`,
    );
    assert.equal(wasm({ ...drop, revision: drop.world.revision - 1 }), null);
    assert.equal(wasm({ ...drop, present: [] }), null);
    assert.equal(wasm({ ...drop, world: played.world }), null);
    for (const present of [["vale"], []]) {
      const request = { ...seats, op: "view", world: played.world, present };
      assert.ok(
        isDeepStrictEqual(wasm(request), run(request)),
        `drop private ${seed}/${present}`,
      );
    }
    const forged = structuredClone(reply.world);
    forged.log.at(-1).targetId = "keeper";
    assert.equal(wasm({ ...seats, op: "view", world: forged }), null);
    const invalid = structuredClone(stage);
    invalid.knowledge.pending.push({ factId: "unsettled" });
    const saved = structuredClone(invalid);
    assert.equal(wasm({ ...giving, world: invalid }), null);
    assert.deepEqual(invalid, saved);
    assert.equal(wasm({ ...probe, revision: probe.revision - 1 }), null);
    assert.equal(wasm({ ...probe, present: [] }), null);
    assert.equal(
      wasm({ ...probe, world: stage, revision: stage.revision }),
      null,
    );
  }
  for (const change of [
    (world) => {
      world.log.at(-1).actorId = "keeper";
    },
    (world) => {
      delete world.knowledge.known.vale["quest:keeper:pond"];
    },
    (world) => {
      world.speechVoices.vale = ["keeper"];
    },
  ]) {
    const world = structuredClone(sample.world);
    change(world);
    assert.equal(wasm({ ...sample, world }), null);
  }
  const repeat = {
    ...acceptance,
    world: accepted.world,
    revision: accepted.world.revision,
  };
  assert.equal(pinned(repeat).ok, false);
  assert.equal(wasm(repeat), null);
  assert.equal(
    wasm({ ...acceptance, revision: acceptance.revision - 1 }),
    null,
  );
  assert.equal(wasm({ ...acceptance, present: [] }), null);
  const missingClaim = structuredClone(acceptance.world);
  delete missingClaim.knowledge.facts["claim:hub:keeper-log:pond-signal"];
  assert.equal(wasm({ ...acceptance, world: missingClaim }), null);
  const forgedFact = structuredClone(acceptance.world);
  forgedFact.knowledge.facts["quest:keeper:pond"].source.eventSeq = 1;
  assert.equal(wasm({ ...acceptance, world: forgedFact }), null);
  const changedWant = structuredClone(accepted.world);
  changedWant.actors.vale.want.step.crossing = "train";
  assert.equal(wasm({ ...seats, op: "view", world: changedWant }), null);
});
