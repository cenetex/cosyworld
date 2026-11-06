import { it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authoringField,
  authoringFieldEdit,
} from "../v2/card-game/authoring-fields.mjs";
import {
  authoringCardId,
  buildAuthoringTree,
} from "../v2/card-game/authoring-tree.mjs";
import {
  applySourceEdit,
  sourceEdit,
} from "../v2/card-game/authoring-edits.mjs";
const read = (path) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const greek = {
  pack: read("../v2/content/greek-drama/card-world.json"),
  bridge: read("../v2/worlds/greek-drama/card-bridge.json"),
};
const cardAt = (source, path, role = "field") =>
  buildAuthoringTree(source).cards.find(
    (card) => card.id === authoringCardId(path, role),
  );
const fieldAt = (source, path) => authoringField(source, cardAt(source, path));
const apply = (source, field, text) =>
  applySourceEdit(source, authoringFieldEdit(source, field, text));
const route = greek.pack.routes.findIndex((entry) => entry.sealed);
const lane = ["bridge", "transports", "greek-ship", "lanes", 1];
const small = (value) => ({
  pack: { choices: [{ id: "test", future: value }] },
});
const future = ["pack", "choices", 0, "future"];

it("edits Antigone's completion flag while retaining the full handwritten step", () => {
  const original = JSON.stringify(greek);
  const path = ["pack", "avatars", "greek-antigone", "want", "step", "finish"];
  const field = fieldAt(greek, path);
  assert.equal(field.type, "string");
  assert.deepEqual(field.path, path);
  const result = apply(greek, field, "greek-funeral-complete");
  const expected = structuredClone(greek);
  expected.pack.avatars["greek-antigone"].want.step.finish =
    "greek-funeral-complete";
  assert.deepEqual(result.source, expected);
  assert.equal(
    JSON.stringify(applySourceEdit(result.source, result.undo).source),
    original,
  );
  assert.equal(JSON.stringify(greek), original);
});

it("edits one route hint and preserves its gate, alternative roads and unknown data", () => {
  const source = structuredClone(greek);
  source.pack.future = { opaque: ["kept", { version: 3 }] };
  const path = ["pack", "routes", route, "sealed", "reason"];
  const result = apply(
    source,
    fieldAt(source, path),
    "Bring the account.\n雪 stays on the road.",
  );
  const expected = structuredClone(source);
  expected.pack.routes[route].sealed.reason =
    "Bring the account.\n雪 stays on the road.";
  assert.deepEqual(result.source, expected);
  assert.deepEqual(applySourceEdit(result.source, result.undo).source, source);
  const unchanged = authoringFieldEdit(
    source,
    fieldAt(source, path),
    source.pack.routes[route].sealed.reason,
  );
  assert.deepEqual(unchanged.changes, []);
});

it("edits the ship lane hint while preserving cargo alternatives and cross-pack ports", () => {
  const path = [...lane, "reason"];
  const result = apply(
    greek,
    fieldAt(greek, path),
    "Bring provisions or a Hoppy Cat item aboard.",
  );
  const expected = structuredClone(greek);
  expected.bridge.transports["greek-ship"].lanes[1].reason =
    "Bring provisions or a Hoppy Cat item aboard.";
  assert.deepEqual(result.source, expected);
  for (const [path, role] of [
    [lane, "field"],
    [[...lane, "opensWith"], "field"],
    [[...lane, "from"], "link"],
    [[...lane, "opensWith", 0, "conditions", 0, "item"], "link"],
  ])
    assert.equal(authoringField(greek, cardAt(greek, path, role)), null);
});

it("uses result-state labels and expected values for a live gate switch", () => {
  const path = ["pack", "routes", 0, "live"],
    field = fieldAt(greek, path);
  assert.equal(field.action, "Disable live conditions");
  const result = apply(greek, field);
  assert.equal(result.source.pack.routes[0].live, false);
  const next = fieldAt(result.source, path);
  assert.equal(next.action, "Enable live conditions");
  assert.deepEqual(apply(result.source, next).source, greek);
  assert.throws(() => authoringFieldEdit(result.source, field), /changed/);
  assert.throws(
    () => authoringFieldEdit(greek, field, "false"),
    /Enable or Disable/,
  );
});

it("preserves numeric types for clock boundaries and an imported draft cost", () => {
  const clock = [
    "pack",
    "avatars",
    "greek-polynices-shade",
    "appearsWhen",
    0,
    "from",
  ];
  assert.equal(
    apply(greek, fieldAt(greek, clock), " 2.4e1 ").source.pack.avatars[
      "greek-polynices-shade"
    ].appearsWhen[0].from,
    24,
  );
  const source = structuredClone(greek);
  source.pack.routes[route].cost = 3;
  const path = ["pack", "routes", route, "cost"];
  const result = apply(source, fieldAt(source, path), "-2");
  assert.equal(result.source.pack.routes[route].cost, -2);
  assert.deepEqual(applySourceEdit(result.source, result.undo).source, source);
  const decimal = small(0.5),
    field = fieldAt(decimal, future);
  for (const [text, value] of [
    ["-2.5e-1", -0.25],
    ["1E+2", 100],
    ["0", 0],
  ])
    assert.equal(
      apply(decimal, field, text).source.pack.choices[0].future,
      value,
    );
});

it("rejects blank, non-finite, ambiguous and unsafe numbers before changing source", () => {
  const source = small(1),
    field = fieldAt(source, future),
    original = JSON.stringify(source);
  for (const text of [
    "",
    " ",
    "NaN",
    "Infinity",
    "-Infinity",
    "+2",
    "0x10",
    "01",
    ".5",
    "2.",
    "2 apples",
    "1e309",
    "1e-999",
    "-0",
    "1.5",
    "9007199254740993",
  ])
    assert.throws(() => authoringFieldEdit(source, field, text), /number/);
  assert.equal(JSON.stringify(source), original);
  assert.throws(() => authoringFieldEdit(source, field, 2), /text/);
});

it("protects declared identities, type tags, reference lists and null fields", () => {
  const source = small({
    id: "stable",
    namespace: "pack",
    packId: "cosyworld.pack",
    schemaVersion: 1,
    kind: "flag",
    type: "future",
    path: ["port"],
    topics: ["lore"],
    empty: null,
  });
  for (const key of Object.keys(source.pack.choices[0].future)) {
    const path = [
      ...future,
      key,
      ...(["path", "topics"].includes(key) ? [0] : []),
    ];
    const field = fieldAt(source, path);
    assert.equal(field.editable, false);
    assert.throws(() =>
      authoringFieldEdit(source, { ...field, editable: true }, "changed"),
    );
  }
});

it("keeps internal generation fields hidden, including nested arrays", () => {
  const source = small({
    systemPrompt: "private",
    model: "internal",
    provider: "internal",
    generation: { samples: ["private"] },
  });
  for (const path of [
    [...future, "systemPrompt"],
    [...future, "model"],
    [...future, "provider"],
    [...future, "generation", "samples", 0],
  ]) {
    const field = fieldAt(source, path);
    assert.equal(field.hidden, true);
    assert.equal(field.text, "");
    assert.equal(Object.hasOwn(field, "value"), false);
    assert.equal(field.editable, false);
  }
  const named = {
    pack: { avatars: { "model-maker": { want: { future: "visible" } } } },
  };
  assert.equal(
    fieldAt(named, ["pack", "avatars", "model-maker", "want", "future"]).hidden,
    false,
  );
});

it("rejects stale field cards, stale commands and changed paths atomically", () => {
  const source = small("first"),
    card = cardAt(source, future),
    field = authoringField(source, card);
  const edit = authoringFieldEdit(source, field, "second");
  const current = applySourceEdit(
    source,
    sourceEdit(source, "Other edit", [{ path: future, value: "new" }]),
  ).source;
  const before = JSON.stringify(current);
  assert.throws(() => authoringField(current, card), /changed/);
  assert.throws(() => authoringFieldEdit(current, field, "third"), /changed/);
  assert.throws(() => applySourceEdit(current, edit), /changed/);
  assert.throws(
    () =>
      authoringFieldEdit(
        source,
        { ...field, path: ["pack", "__proto__", "bad"] },
        "x",
      ),
    /changed/,
  );
  assert.equal(JSON.stringify(current), before);
  assert.equal({}.bad, undefined);
});
