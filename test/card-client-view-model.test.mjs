import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { withPending } from "../v2/card-game/beats.mjs";
import { cardActions } from "../v2/card-game/cards.mjs";
import {
  handFocusId,
  holdDialogueChoice,
  loadClientViewModel,
  matchingPairAction,
  phase,
  roomCardOrder,
  showPendingSpeech,
} from "../v2/card-game/presentation.mjs";
import { lockedStack } from "../v2/card-game/mystery-view.mjs";
import { pickedQuestAction } from "../v2/card-game/quest-action.mjs";
import { createWorld } from "../v2/card-game/world.mjs";

function combinations(fields) {
  return Array.from({ length: 2 ** fields.length }, (_, bits) =>
    Object.fromEntries(
      fields.map((field, index) => [field, Boolean(bits & (1 << index))]),
    ),
  );
}

it("keeps dialogue, hand, and action presentation identical with the Rust module", async () => {
  const phases = combinations([
    "reviewing",
    "revealing",
    "inFlight",
    "lingering",
    "raised",
    "chosen",
    "rested",
  ]);
  const choices = combinations([
    "queued",
    "live",
    "complete",
    "speaking",
    "next",
  ]);
  choices.push({ live: true, complete: true, next: { seq: 3 } });
  const pending = combinations([
    "shared",
    "generating",
    "hasLine",
    "preparing",
    "lineFirst",
    "ownPlay",
    "committed",
  ]);
  const speechBeats = combinations([
    "committed",
    "spoken",
    "sameTurn",
    "sameSpeaker",
  ]).map(({ committed, spoken, sameTurn, sameSpeaker }, key) => ({
    key,
    committed,
    line: spoken ? { text: "Earlier words." } : null,
    turn: sameTurn ? 7 : 6,
    speakerId: sameSpeaker ? "moth" : "vale",
    actions: [{ text: `Action ${key}.` }],
  }));
  const effect = speechBeats.find(
    (beat) =>
      !beat.committed &&
      !beat.line &&
      beat.turn === 7 &&
      beat.speakerId === "moth",
  );
  const following = {
    ...effect,
    key: "following",
    actions: [{ text: "Later." }],
  };
  const stacks = [
    [],
    speechBeats,
    [...speechBeats].reverse(),
    [following, ...speechBeats],
    speechBeats.filter((beat) => beat !== effect),
  ];
  const ids = ["a", "b", "c", "d"];
  const holders = [undefined, "missing", ...ids];
  const hands = Array.from({ length: 7 ** ids.length }, (_, pattern) =>
    ids.map((id, index) => {
      const state = Math.floor(pattern / 7 ** index) % 7;
      return { id, hidden: state > 0, holder: holders[state - 1] };
    }),
  );
  hands.push(
    [],
    [{ id: "a" }, { hidden: true }, { id: "b" }],
    [{ id: "a", hidden: true, holder: "b" }, { id: "a" }, { id: "b" }],
  );
  const preferred = [[], ["missing"], [undefined], ...ids.map((id) => [id])];
  preferred.push(["a", "c", "b"], ["b", "a", "missing"]);
  const stackStates = combinations(["open", "holderExpanded"]);
  const roomRoles = combinations(
    ids.flatMap((id) => [`local:${id}`, `way:${id}`]),
  );
  const roomEnds = [null, "a", "c", "missing"];
  const trade = createWorld({ seed: 9 });
  trade.actors.moth.place = "station";
  trade.items.lamp.holder = "vale";
  const uncover = structuredClone(trade);
  uncover.items.cloth.holder = "lamp";
  const pairOptions = [
    { kind: "trade", cards: ["lamp", "cloth"], key: "wrong-kind" },
    { kind: "use", cards: ["lamp", "cloth", "vale"], key: "wide" },
    { kind: "use", cards: ["lamp", "lamp"], key: "one-card" },
    { kind: "use", cards: ["cloth", "lamp"], key: "first" },
    { kind: "use", cards: ["lamp", "cloth"], key: "second" },
  ];
  const questOptions = [
    { kind: "drop", tarot: 0, item: "lamp", key: "item" },
    { kind: "accept", tarot: 1, label: "Collect", key: "wrong-quest" },
    { kind: "drop", tarot: 0, key: "discard" },
    { kind: "accept", tarot: 0, label: "Turn over", key: "turn" },
    { kind: "accept", tarot: 0, label: "Collect", key: "reward" },
  ];
  const quests = ["down", "up", "reward", "locked", "offered"].map((face) => ({
    kind: "arcanum",
    face,
    turnable: face === "down",
    index: 0,
    key: "tarot:0",
  }));
  const project = () => [
    phases.map(phase),
    choices.map(holdDialogueChoice),
    pending.map(showPendingSpeech),
    stacks.map((beats) => withPending(beats, { turn: 7, speakerId: "moth" })),
    hands.map((frames) => preferred.map((picks) => handFocusId(frames, picks))),
    Array.from({ length: ids.length + 1 }, (_, count) =>
      [...ids, "missing"].map((id) =>
        stackStates.map(({ open, holderExpanded }) =>
          lockedStack(ids.slice(0, count), id, open, holderExpanded),
        ),
      ),
    ),
    roomRoles.flatMap((roles) =>
      roomEnds.flatMap((back) =>
        roomEnds.map((featured) =>
          roomCardOrder(
            ids,
            back,
            featured,
            (id) => roles[`local:${id}`],
            (id) => roles[`way:${id}`],
          ),
        ),
      ),
    ),
    [trade, uncover].map((world) =>
      [
        ["lamp", "cloth"],
        ["cloth", "lamp"],
      ].map((pair) => cardActions(world, pair)),
    ),
    [false, true].map((exact) =>
      matchingPairAction(pairOptions, "use", ["lamp", "cloth"], exact),
    ),
    quests.flatMap((quest) =>
      [questOptions, questOptions.slice(0, 3), []].map((options) =>
        pickedQuestAction(quest, options, 7, "7:tarot:0"),
      ),
    ),
  ];
  const before = project();

  expect(
    await loadClientViewModel("data:application/wasm;base64,invalid"),
  ).toBe(false);
  expect(project()).toEqual(before);

  const wasm = await readFile(
    new URL("../v2/card-game/client-view-model.wasm", import.meta.url),
  );
  const { instance } = await WebAssembly.instantiate(wasm);
  expect(instance.exports.hand_focus).toBeTypeOf("function");
  expect(instance.exports.locked_stack).toBeTypeOf("function");
  expect(instance.exports.room_card_order).toBeTypeOf("function");
  expect(instance.exports.quest_action).toBeTypeOf("function");
  expect(instance.exports.matching_pair_action).toBeTypeOf("function");
  expect(instance.exports.pending_speech).toBeTypeOf("function");
  expect(instance.exports.pending_effect).toBeTypeOf("function");
  expect(
    await loadClientViewModel(
      `data:application/wasm;base64,${wasm.toString("base64")}`,
    ),
  ).toBe(true);
  expect(project()).toEqual(before);
  expect(showPendingSpeech({ ownPlay: true, committed: true })).toBe(false);
  expect(
    showPendingSpeech({ ownPlay: true, committed: true, shared: true }),
  ).toBe(true);
  expect(
    withPending(speechBeats, { turn: 7, speakerId: "moth" }).pending.actions,
  ).toBe(effect.actions);
  expect(cardActions(trade, ["lamp", "cloth"]).actions[0]?.kind).toBe("trade");
  expect(matchingPairAction(pairOptions, "use", ["lamp", "cloth"], true)).toBe(
    pairOptions[3],
  );
  expect(pickedQuestAction(quests[2], questOptions, 7, null).action).toBe(
    questOptions[4],
  );
});
