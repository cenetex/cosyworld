import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { rulesName, wireRules } from "../v2/scripts/rules-wiring.mjs";

const dir = "v2/orchestrator-rust/src/card_shared";
const engine = `${dir}/engine.rs`;
const builder = "v2/scripts/build-card-shared-engine.mjs";
const pins = "test/card-released-rules.test.mjs";
const paths = [engine, `${dir}/full_world.rs`, pins, builder];
const start = Object.fromEntries(
  paths.map((path) => [
    path,
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
  ]),
);
const live = Number(
  /const VERSION: &str = "full-card-world\/(\d+)";/u.exec(start[engine])[1],
);
const hash = (n) => n.toString(16).padStart(64, "0");
let files = start;
for (let n = live; n <= 1000; n++) files = wireRules(files, n, hash(n));

it("mints rules past 299 and past 999, named by number", () => {
  expect([299, 1000].map(rulesName)).toEqual(["RULES_299", "RULES_1000"]);
  for (const n of [299, 300, 999, 1000]) {
    const name = rulesName(n);
    expect(files[engine]).toContain(
      `pub(super) const ${name}_VERSION: &str = "full-card-world/${n}";`,
    );
    expect(files[engine]).toContain(
      `const ${name}_SOURCE: &str = include_str!("engine-v${n}.js");`,
    );
    expect(files[engine]).toContain(`\n            | ${name}_VERSION\n`);
    expect(files[engine]).toContain(
      `\n        ${name}_VERSION => ${name}_SOURCE,\n`,
    );
    expect(
      files[paths[1]].match(new RegExp(`engine::${name}_VERSION,\n`, "gu")),
    ).toHaveLength(2);
    expect(files[pins]).toContain(`\n  ${n}: "${hash(n)}",\n`);
  }
  expect(files[engine]).toContain(
    'pub(super) const VERSION: &str = "full-card-world/1001";',
  );
  expect(files[engine]).toContain(
    'const SOURCE: &str = include_str!("engine-v1001.js");',
  );
  expect(files[builder]).toContain("card_shared/engine-v1001.js");
});

it("keeps every released name and pin byte for byte", () => {
  const gone = (path) => {
    const now = new Set(files[path].split("\n"));
    return start[path].split("\n").filter((line) => !now.has(line));
  };
  expect(gone(engine)).toEqual([
    `pub(super) const VERSION: &str = "full-card-world/${live}";`,
    `const SOURCE: &str = include_str!("engine-v${live}.js");`,
  ]);
  expect(gone(paths[1])).toEqual([]);
  expect(gone(builder)).toEqual([
    `  "../orchestrator-rust/src/card_shared/engine-v${live}.js",`,
  ]);
  expect(files[pins].startsWith(start[pins].replace(/\};\n[^]*$/u, ""))).toBe(
    true,
  );
});

it("stops when the wiring does not name the previous rules", () => {
  expect(() => wireRules(start, live + 1, hash(0))).toThrow(
    `engine.rs does not name rules ${live}.`,
  );
});
