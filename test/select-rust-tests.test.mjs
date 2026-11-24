import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as select from "../scripts/select-rust-tests.mjs";

const config = JSON.parse(
  readFileSync(new URL("../scripts/fast-smokes.json", import.meta.url), "utf8"),
);
const SRC = "v2/orchestrator-rust/src";
const modules = select.moduleTree();
const inputs = select.rustInputs(modules);
const compiled = select.compiledInputs(modules);
const pick = (...changed) =>
  select.selectRustTests(changed, config, { modules, inputs, compiled });
const N = "routes::card_game::narrative::";

describe("fast check Rust test selection", () => {
  it("maps every crate source file to its test path", () => {
    const missing = readdirSync(SRC, { recursive: true })
      .filter((f) => f.endsWith(".rs") && !f.startsWith("bin/"))
      .filter((f) => !modules.has(`${SRC}/${f}`));
    expect(missing).toEqual([]);
    const path = (f) => modules.get(`${SRC}/${f}`).join("::");
    expect(path("card_narrative/voice_eval.rs")).toBe(`${N}voice_eval`);
    expect(path("startup.rs")).toBe("startup");
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

  it("skips it when only a file a test reads changed", () => {
    for (const file of [
      "test/helpers/long-play.mjs",
      "v2/card-game/narrative.mjs",
    ])
      expect(pick(file), file).toEqual([]);
  });

  it("runs the readers of a file the crate compiles in", () => {
    expect(pick("v2/card-game/senses.json")).toEqual([N]);
    expect(pick("v2/card-game/voices.json")).toEqual([
      "routes::card_game::local::",
      "routes::card_voices::",
    ]);
    expect(pick("v2/card-game/index.html")).toEqual(["routes::card_game::"]);
  });

  it("runs funeral parity when the source world changes", () => {
    expect(pick("v2/card-game/world.mjs")).toEqual([
      "card_shared::polynices_tests::",
      "card_shared::world_life_tests::",
    ]);
  });

  it("runs receiver journal replay when authored radio rules change", () => {
    expect(pick("v2/card-game/radio-item.mjs")).toEqual([
      "card_shared::quest_loop_tests::",
    ]);
  });

  it("runs consequence replay for rule modules and pinned evidence", () => {
    // The old pinned traces (rules 130-132) retired with the rules 133 bump, so
    // the rule modules the crate names, and the played-world helper it reads.
    expect(pick("v2/card-game/world.mjs")).toContain(
      "card_shared::world_life_tests::",
    );
    expect(
      pick("test/helpers/long-play.mjs", "v2/card-game/radio-item.mjs"),
    ).toContain("card_shared::world_life_tests::");
  });

  it("runs the narrative and voice tests when their inputs change", () => {
    const narrator = `${SRC}/card_shared/narrator.js`;
    expect(pick("v2/card-game/senses.json", narrator)).toEqual([
      N,
      "card_shared::narrator::",
    ]);
    expect(pick("v2/card-game/narrative.mjs", narrator)).toEqual([
      `${N}between::`,
      `${N}waking::`,
      "card_shared::narrator::",
    ]);
    expect(pick(`${SRC}/card_narrative/authored-text.json`)).toEqual([
      `${N}authored::`,
      `${N}imported::`,
      `${N}instruction::`,
    ]);
  });

  it("runs a changed module, the module that embeds a bundle, and every table reader", () => {
    expect(pick(`${SRC}/card_shared/engine-v133.js`)).toEqual([
      "card_shared::engine::",
    ]);
    expect(pick(`${SRC}/card_shared/narrator.js`)).toEqual([
      "card_shared::narrator::",
    ]);
    expect(pick(`${SRC}/card_shared/content.json`)).toEqual([
      "card_shared::content::",
      `${N}instruction::`,
    ]);
    const packs = pick(
      "v2/card-game/packs.json",
      `${SRC}/card_shared/content.json`,
    );
    expect(packs).toContain("routes::card_game::");
    expect(packs).toContain("card_shared::content::");
    expect(packs).toContain("card_shared::world_life_tests::");
    expect(packs).not.toContain(N); // routes::card_game:: covers it
    expect(pick("v2/core-c/src/card_table.c")).toEqual(["card_shared::"]);
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
    const files = [
      "shutdown",
      "rate_limit",
      "startup",
      "play_metrics",
      "passkey_access",
      "signed_envelope",
      "ai_registry",
      "account_auth",
      "account_avatars",
      "account_revision",
      "ai_bench",
      "ai_gateway",
      "ai_readiness",
      "config",
    ];
    expect(pick(...files.map((m) => `${SRC}/${m}.rs`))).toHaveLength(
      config.rust.max,
    );
  });
});
