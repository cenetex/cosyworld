import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  moduleTree,
  rustInputs,
  selectRustTests,
} from "../scripts/select-rust-tests.mjs";

const config = JSON.parse(
  readFileSync(new URL("../scripts/fast-smokes.json", import.meta.url), "utf8"),
);
const SRC = "v2/orchestrator-rust/src";
const modules = moduleTree();
const inputs = rustInputs(modules);
const pick = (...changed) =>
  selectRustTests(changed, config, { modules, inputs });
const NARRATIVE = "routes::card_game::narrative::";
const DEFAULT = ["card_shared::", NARRATIVE];

describe("fast check Rust test selection", () => {
  it("maps every crate source file to its test path", () => {
    const sources = readdirSync(SRC, { recursive: true })
      .filter((f) => f.endsWith(".rs"))
      .map((f) => `${SRC}/${f}`);
    // Binaries are separate crates, whose tests only the train runs.
    expect(
      sources.filter((f) => !modules.has(f) && !f.startsWith(`${SRC}/bin/`)),
    ).toEqual([]);
    const path = (f) => modules.get(`${SRC}/${f}`).join("::");
    expect(path("card_narrative.rs")).toBe("routes::card_game::narrative");
    expect(path("card_narrative/voice_eval.rs")).toBe(
      "routes::card_game::narrative::voice_eval",
    );
    expect(path("tests/action_hand_tests.rs")).toBe("tests::action_hand_tests");
    expect(path("card_policy/ranker.rs")).toBe("card_policy::ranker");
  });

  it("names only real modules and derived inputs in its config", () => {
    const named = [config.rust.default, config.rust.rules.map((r) => r.modules)];
    for (const file of named.flat(2))
      expect(modules.has(`${SRC}/${file}`), file).toBe(true);
    for (const input of config.rust.ignoreInputs)
      expect(inputs.has(input), input).toBe(true);
  });

  it("skips the Rust job when no Rust input changed", () => {
    expect(pick("v2/card-game/world.mjs", "docs/release.md")).toEqual([]);
    expect(pick("package.json")).toEqual([]);
  });

  it("runs the narrative and voice tests when the place lines change", () => {
    expect(pick("v2/card-game/senses.json")).toEqual([NARRATIVE]);
    expect(pick("test/fixtures/card-voice-replies.json")).toEqual([
      `${NARRATIVE}instruction::`,
      `${NARRATIVE}voice_eval::`,
    ]);
    expect(pick("v2/card-game/narrative.mjs")).toEqual([
      `${NARRATIVE}between::`,
      `${NARRATIVE}waking::`,
    ]);
  });

  it("runs a changed module's tests, and a bundle's module", () => {
    expect(pick(`${SRC}/card_narrative/voice_eval.rs`)).toEqual([
      `${NARRATIVE}voice_eval::`,
    ]);
    expect(pick(`${SRC}/card_shared/engine-v98.js`)).toEqual(["card_shared::"]);
    expect(pick(`${SRC}/card_shared/narrator.js`)).toEqual(["card_shared::"]);
    expect(pick(`${SRC}/card_narrative/authored-text.json`)).toEqual([
      NARRATIVE,
    ]);
  });

  it("runs every reader of a shared table", () => {
    const packs = pick("v2/card-game/packs.json");
    expect(packs).toContain("routes::card_game::");
    expect(packs).toContain("card_shared::full_tests::");
    // routes::card_game:: already covers the narrative module.
    expect(packs).not.toContain(NARRATIVE);
    expect(pick("v2/content/official/rules.json")).toEqual([
      "content_load::",
      "content_registry::",
    ]);
  });

  it("runs the default for crate-wide files and the kernel", () => {
    for (const file of [
      "v2/orchestrator-rust/Cargo.lock",
      "v2/orchestrator-rust/build.rs",
      `${SRC}/main.rs`,
      "v2/scripts/check-rust.sh",
    ])
      expect(pick(file), file).toEqual(DEFAULT);
    expect(pick("v2/core-c/src/card_table.c")).toEqual([
      "card_shared::",
      "kernel::",
    ]);
    expect(pick("v2/scripts/build-card-assets.mjs")).toEqual([
      "routes::card_game::",
    ]);
  });

  it("drops a child the parent covers, and caps the count", () => {
    expect(
      pick(`${SRC}/card_narrative/voice_eval.rs`, `${SRC}/card_narrative.rs`),
    ).toEqual([NARRATIVE]);
    const many = [
      "combat.rs",
      "movement.rs",
      "spatial.rs",
      "notice.rs",
      "shutdown.rs",
      "room_history.rs",
      "story_metrics.rs",
    ].map((m) => `${SRC}/${m}`);
    expect(pick(...many)).toHaveLength(config.rust.max);
  });
});
