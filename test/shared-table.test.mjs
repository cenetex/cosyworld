import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { newTable, applyTable, canVisit } from "../v2/card-game/world.mjs";

describe("shared card table authority", () => {
  it("matches C for claim, custody, full rooms, disappearing paths and random interleavings", () => {
    const dir = mkdtempSync(join(tmpdir(), "card-table-"));
    try {
      const bin = join(dir, "table");
      execFileSync(
        "cc",
        [
          "-std=c11",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-fsanitize=address,undefined",
          "-I",
          "v2/core-c/include",
          "v2/core-c/src/card_table.c",
          "v2/core-c/tests/card_table_driver.c",
          "-o",
          bin,
        ],
        { cwd: resolve(".") },
      );
      const actions = [];
      const add = (kind, actor, item = -1, target = -1) =>
        actions.push({ kind, actor, item, target });
      for (let a = 0; a < 8; a++) {
        add(1, a);
        add(3, a);
      }
      for (let a = 0; a < 8; a++) add(5, a, -1, 0);
      add(7, 0, 0);
      add(6, 1, 0);
      add(5, 1, -1, 1);
      add(5, 0, -1, 1);
      add(5, 4, -1, 0);
      add(8, 2, 2, 3);
      add(9, 3, 2);
      add(2, 3);
      add(1, 3);
      add(3, 3);
      let seed = 94832;
      const random = (n) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % n;
      };
      for (let n = 0; n < 3000; n++)
        add(random(13), random(10) - 1, random(10) - 1, random(11) - 1);
      const lines = execFileSync(bin, {
        input: actions
          .map((a) => `${a.kind} ${a.actor} ${a.item} ${a.target}\n`)
          .join(""),
        encoding: "utf8",
        maxBuffer: 10_000_000,
      })
        .trim()
        .split("\n");
      const w = newTable();
      for (let n = 0; n < actions.length; n++) {
        const before = structuredClone(w);
        const code = applyTable(w, actions[n]);
        if (code) expect(w).toEqual(before);
        const expected = [
          code,
          w.version,
          ...w.claimed,
          ...w.present,
          ...w.places,
          ...w.holders,
          ...w.uses,
          ...w.homes,
          ...w.gates,
          w.turn,
        ];
        for (let a = 0; a < 8; a++)
          for (let p = 0; p < 9; p++) expected.push(Number(canVisit(w, a, p)));
        expect(lines[n].split(" ").map(Number), `action ${n}`).toEqual(
          expected,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
