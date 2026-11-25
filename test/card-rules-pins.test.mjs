import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

const dir = new URL(
  "../v2/orchestrator-rust/src/card_shared/",
  import.meta.url,
);
const read = (name) => readFileSync(new URL(name, dir));

it("pins every rules bundle the server loads in rules.json", () => {
  const pins = JSON.parse(read("rules.json"));
  const released = readFileSync(
    new URL("./card-released-rules.test.mjs", import.meta.url),
    "utf8",
  );
  for (const [, version, pin] of released.matchAll(
    /^\s*(\d+): "([0-9a-f]{64})",$/gmu,
  ))
    expect(pins[version], `Released shared rules ${version}`).toBe(pin);
  const bundles = readdirSync(dir).filter((name) =>
    /^engine-v\d+\.js$/u.test(name),
  );
  expect(
    Object.keys(pins)
      .map((version) => `engine-v${version}.js`)
      .sort(),
  ).toEqual(bundles.sort());
  for (const [version, pin] of Object.entries(pins))
    expect(
      createHash("sha256")
        .update(read(`engine-v${version}.js`))
        .digest("hex"),
      version,
    ).toBe(pin);
});
