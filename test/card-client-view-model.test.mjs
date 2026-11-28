import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  handFocusId,
  holdDialogueChoice,
  loadClientViewModel,
  phase,
} from "../v2/card-game/presentation.mjs";
import { lockedStack } from "../v2/card-game/mystery-view.mjs";

function combinations(fields) {
  return Array.from({ length: 2 ** fields.length }, (_, bits) =>
    Object.fromEntries(
      fields.map((field, index) => [field, Boolean(bits & (1 << index))]),
    ),
  );
}

it("keeps dialogue, hand focus, and card stacks identical with the Rust module", async () => {
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
  const project = () => [
    phases.map(phase),
    choices.map(holdDialogueChoice),
    hands.map((frames) => preferred.map((picks) => handFocusId(frames, picks))),
    Array.from({ length: ids.length + 1 }, (_, count) =>
      [...ids, "missing"].map((id) =>
        stackStates.map(({ open, holderExpanded }) =>
          lockedStack(ids.slice(0, count), id, open, holderExpanded),
        ),
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
  expect(
    await loadClientViewModel(
      `data:application/wasm;base64,${wasm.toString("base64")}`,
    ),
  ).toBe(true);
  expect(project()).toEqual(before);
});
