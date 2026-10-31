import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bundleModules,
  engineGate,
  importSpecifiers,
  summary,
} from "../v2/scripts/engine-gate.mjs";

describe("shared rules engine gate", () => {
  it("reads static, re-export, side-effect, and literal dynamic imports", () => {
    const source = `
      import a from "./a.mjs";
      import { b,
        c } from './b.mjs';
      import "./side.mjs";
      export * from "./again.mjs";
      import data from "./d.json" with { type: "json" };
      const later = await import("./later.mjs");
      import pkg from "esbuild";
      // import gone from "./commented.mjs";
      /* import also from "./block.mjs"; */
      const url = "https://example.test//not-a-comment";`;
    expect(importSpecifiers(source)).toEqual([
      "./a.mjs",
      "./b.mjs",
      "./side.mjs",
      "./again.mjs",
      "./d.json",
      "./later.mjs",
    ]);
  });

  it("walks the import graph from the entry once per module", () => {
    const base = mkdtempSync(join(tmpdir(), "engine-gate-"));
    mkdirSync(join(base, "lib"));
    writeFileSync(join(base, "entry.mjs"), 'import "./lib/a.mjs";\n');
    writeFileSync(
      join(base, "lib/a.mjs"),
      'import "./b.mjs";\nimport d from "../data.json" with { type: "json" };\n',
    );
    writeFileSync(join(base, "lib/b.mjs"), 'import "./a.mjs";\n');
    writeFileSync(join(base, "data.json"), "{}");
    writeFileSync(join(base, "unused.mjs"), "");
    expect(bundleModules("entry.mjs", base)).toEqual([
      "data.json",
      "entry.mjs",
      "lib/a.mjs",
      "lib/b.mjs",
    ]);
  });

  it("finds the real shared bundle's modules", () => {
    const modules = bundleModules();
    expect(modules).toContain("v2/card-game/shared-world-entry.mjs");
    expect(modules).toContain("v2/card-game/shared-world.mjs");
    expect(modules).not.toContain("v2/card-game/app.mjs");
  });

  it("warns on unlabelled engine changes and passes deliberate ones", () => {
    const modules = ["v2/card-game/world.mjs"];
    const bundle = "v2/orchestrator-rust/src/card_shared/engine-v58.js";
    const quiet = engineGate({ changed: ["README.md"], labels: [], modules });
    expect(quiet).toMatchObject({ engine: [], warn: false });
    const bare = engineGate({
      changed: [
        bundle,
        "v2/card-game/world.mjs",
        "test/card-released-rules.test.mjs",
      ],
      labels: [],
      modules,
    });
    expect(bare.engine).toHaveLength(3);
    expect(bare.warn).toBe(true);
    expect(summary(bare, modules)).toContain(
      "the `engine` label or a design note",
    );
    const labelOnly = engineGate({
      changed: [bundle],
      labels: ["engine"],
      modules,
    });
    expect(labelOnly.warn).toBe(true);
    const deliberate = engineGate({
      changed: [bundle, "docs/design/engine-v58.md"],
      labels: ["engine"],
      modules,
    });
    expect(deliberate.warn).toBe(false);
    expect(summary(deliberate, modules)).toContain("Shared bundle modules (1");
  });
});
