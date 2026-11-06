import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as select from "../scripts/select-rust-tests.mjs";

const config = JSON.parse(
  readFileSync(new URL("../scripts/fast-smokes.json", import.meta.url), "utf8"),
);
const SRC = "v2/orchestrator-rust/src";
const modules = select.moduleTree();
const inputs = select.rustInputs(modules);
const pick = (...changed) =>
  select.selectRustTests(changed, config, { modules, inputs });
const N = "routes::card_game::narrative::";

describe("fast check Rust test selection", () => {
  it("maps every crate source file to its test path", () => {
    const missing = readdirSync(SRC, { recursive: true })
      .filter((f) => f.endsWith(".rs") && !f.startsWith("bin/"))
      .filter((f) => !modules.has(`${SRC}/${f}`));
    expect(missing).toEqual([]);
    const path = (f) => modules.get(`${SRC}/${f}`).join("::");
    expect(path("card_narrative/voice_eval.rs")).toBe(`${N}voice_eval`);
    expect(path("tests/action_hand_tests.rs")).toBe("tests::action_hand_tests");
    expect(path("card_policy/ranker.rs")).toBe("card_policy::ranker");
  });

  it("names only real modules and derived inputs in its config", () => {
    const named = [
      config.rust.default,
      config.rust.rules.map((r) => r.modules),
    ];
    for (const file of named.flat(2))
      expect(modules.has(`${SRC}/${file}`), file).toBe(true);
    for (const input of config.rust.ignoreInputs)
      expect(inputs.has(input), input).toBe(true);
  });

  it("skips the Rust job when no Rust input changed", () => {
    expect(pick("v2/card-game/settings-screen.mjs", "docs/release.md")).toEqual(
      [],
    );
    expect(pick("package.json")).toEqual([]);
  });

  it("runs funeral parity when the source world changes", () => {
    expect(pick("v2/card-game/world.mjs")).toEqual([
      "card_shared::polynices_tests::",
    ]);
  });

  it("runs the narrative and voice tests when their inputs change", () => {
    expect(pick("v2/card-game/senses.json")).toEqual([N]);
    expect(pick("test/fixtures/card-voice-replies.json")).toEqual([
      `${N}instruction::`,
      `${N}voice_eval::`,
    ]);
    expect(pick("v2/card-game/narrative.mjs")).toEqual([
      `${N}between::`,
      `${N}waking::`,
    ]);
    expect(pick(`${SRC}/card_narrative/authored-text.json`)).toEqual([N]);
  });

  it("runs a changed module, a bundle's module, and every table reader", () => {
    expect(pick(`${SRC}/card_shared/engine-v98.js`)).toEqual(["card_shared::"]);
    const packs = pick("v2/card-game/packs.json");
    expect(packs).toContain("routes::card_game::");
    expect(packs).toContain("card_shared::full_tests::");
    expect(packs).not.toContain(N); // routes::card_game:: covers it
    expect(pick("v2/content/official/rules.json")).toEqual([
      "content_load::",
      "content_registry::",
    ]);
    expect(pick("v2/core-c/src/card_table.c")).toEqual([
      "card_shared::",
      "kernel::",
    ]);
  });

  it("runs the default for crate-wide files", () => {
    for (const file of [
      "v2/orchestrator-rust/Cargo.lock",
      `${SRC}/main.rs`,
      `${SRC}/bin/card-policy-lab.rs`,
      "v2/scripts/check-rust.sh",
    ])
      expect(pick(file), file).toEqual(["card_shared::", N]);
  });

  it("drops a child the parent covers, and caps the count", () => {
    expect(
      pick(`${SRC}/card_narrative/voice_eval.rs`, `${SRC}/card_narrative.rs`),
    ).toEqual([N]);
    const many = ["combat", "movement", "spatial", "notice", "shutdown"];
    const files = [...many, "room_history", "story_metrics"];
    expect(pick(...files.map((m) => `${SRC}/${m}.rs`))).toHaveLength(
      config.rust.max,
    );
  });
});
