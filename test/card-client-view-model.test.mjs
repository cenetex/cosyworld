import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  holdDialogueChoice,
  loadClientViewModel,
  phase,
} from "../v2/card-game/presentation.mjs";

function combinations(fields) {
  return Array.from({ length: 2 ** fields.length }, (_, bits) =>
    Object.fromEntries(
      fields.map((field, index) => [field, Boolean(bits & (1 << index))]),
    ),
  );
}

it("keeps dialogue presentation identical after activating the published Rust module", async () => {
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
  const before = [phases.map(phase), choices.map(holdDialogueChoice)];

  expect(
    await loadClientViewModel("data:application/wasm;base64,invalid"),
  ).toBe(false);
  expect([phases.map(phase), choices.map(holdDialogueChoice)]).toEqual(before);

  const wasm = await readFile(
    new URL("../v2/card-game/client-view-model.wasm", import.meta.url),
  );
  expect(
    await loadClientViewModel(
      `data:application/wasm;base64,${wasm.toString("base64")}`,
    ),
  ).toBe(true);
  expect([phases.map(phase), choices.map(holdDialogueChoice)]).toEqual(before);
});
