import { it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createAuthoringState,
  reduceAuthoring,
  authoringAction,
} from "../v2/card-game/authoring-controller.mjs";
import { authoringCardId } from "../v2/card-game/authoring-tree.mjs";
import { sourceEdit, linkPlaces } from "../v2/card-game/authoring-edits.mjs";
const id = (collection, name, role = "entity") =>
  authoringCardId(["pack", collection, name], role);
const select = (state, id) => reduceAuthoring(state, { type: "select", id });
const apply = (state) =>
  reduceAuthoring(state, { type: "apply", ...authoringAction(state) });
const undo = (state) => reduceAuthoring(state, { type: "undo" });
const pair = (state, box, target) => select(select(state, box), target);
const fixture = () => ({
  pack: {
    entry: "a",
    places: {
      a: { name: "Courtyard", exits: ["b"] },
      b: { name: "Harbor", exits: [] },
    },
    avatars: {
      vale: {
        name: "Vale",
        place: "a",
        home: "a",
        want: {
          kind: "place",
          target: "b",
          step: { verb: "lay", items: ["oil"] },
        },
      },
    },
    items: { oil: { name: "Oil", holder: "a", home: "a", extra: [1, 2] } },
  },
  bridge: { future: ["kept"] },
});

it("sets launch from a canonical location or reference and restores exact source", () => {
  const source = fixture(),
    original = JSON.stringify(source);
  const state = select(createAuthoringState(source), id("places", "a"));
  assert.deepEqual(state.source.launch, { schemaVersion: 1, place: "a" });
  assert.deepEqual(state.source.pack, source.pack);
  assert.deepEqual(state.source.bridge, source.bridge);
  assert.equal(select(state, id("places", "a")).sequence, 1);
  const reference = authoringCardId(
    ["pack", "places", "a", "exits", 0],
    "link",
  );
  const next = select(state, reference);
  assert.equal(next.source.launch.place, "b");
  assert.equal(JSON.stringify(undo(undo(next)).source), original);
  assert.equal(JSON.stringify(source), original);
  assert.equal(undo(next).sequence, 3);
});

it("keeps the armed box through branch navigation and preserves launch on placement", () => {
  let state = select(createAuthoringState(fixture()), id("places", "a"));
  const before = JSON.stringify(state.source),
    box = id("places", "b", "contents");
  state = pair(state, box, id("items", "oil"));
  for (const card of [
    authoringCardId(["pack"], "root"),
    id("avatars", "vale", "contents"),
  ])
    assert.strictEqual(select(state, card), state);
  assert.equal(
    authoringAction(state).label,
    "Move Oil from Courtyard to Harbor",
  );
  const next = apply(state);
  assert.equal(next.source.pack.items.oil.holder, "b");
  assert.equal(next.source.pack.items.oil.home, "a");
  assert.equal(next.source.launch.place, "a");
  assert.deepEqual(next.selected, []);
  assert.equal(next.armed, null);
  assert.equal(JSON.stringify(undo(next).source), before);
  assert.equal(state.source.pack.items.oil.holder, "a");
});

it("moves avatars and inventory from resolved cross-branch references", () => {
  const source = fixture();
  source.pack.items.oil.holder = "hub-fox";
  source.pack.choices = [
    { requires: [{ kind: "item_at", item: "oil", place: "a" }] },
  ];
  const initial = createAuthoringState(source);
  const ref = authoringCardId(
    ["pack", "choices", 0, "requires", 0, "item"],
    "link",
  );
  const state = pair(initial, id("avatars", "vale", "contents"), ref);
  assert.equal(authoringAction(state).label, "Move Oil from hub-fox to Vale");
  assert.equal(apply(state).source.pack.items.oil.holder, "vale");
  const moved = apply(
    pair(initial, id("places", "b", "contents"), id("avatars", "vale")),
  );
  assert.equal(moved.source.pack.avatars.vale.place, "b");
  assert.equal(moved.source.pack.avatars.vale.home, "a");
  const external = authoringCardId(["pack", "items", "oil", "holder"], "link");
  assert.strictEqual(select(state, external), state);
});

it("links locations both ways and keeps authored gates and ship lanes intact", () => {
  for (const mode of ["road", "gate", "ship"]) {
    const source = fixture();
    if (mode === "gate")
      source.pack.routes = [{ from: "a", to: "b", opensWith: { flag: "key" } }];
    if (mode === "ship")
      source.bridge.transports = { ship: { place: "b", home: "a" } };
    const state = pair(
      createAuthoringState(source),
      id("places", "a", "contents"),
      id("places", "b"),
    );
    const action = authoringAction(state);
    assert.equal(action.disabled, mode !== "road");
    if (mode === "road") {
      assert.equal(action.label, "Link Courtyard to Harbor and back");
      const next = apply(state);
      assert.deepEqual(next.source.pack.places.b.exits, ["a"]);
      assert.equal(next.source.launch, undefined);
      assert.deepEqual(undo(next).source, source);
    } else assert.throws(() => apply(state), /quest|dock/);
  }
});

it("preserves the full funeral goal and records replacement quests for Undo", () => {
  const pack = JSON.parse(
    readFileSync(
      new URL("../v2/content/greek-drama/card-world.json", import.meta.url),
    ),
  );
  const want = pack.avatars["greek-antigone"].want;
  const unchanged = pair(
    createAuthoringState({ pack }),
    id("avatars", "greek-antigone", "quests"),
    id("places", want.target),
  );
  assert.match(authoringAction(unchanged).reason, /already set/);
  assert.deepEqual(unchanged.source.pack.avatars["greek-antigone"].want, want);
  const source = fixture(),
    state = pair(
      createAuthoringState(source),
      id("avatars", "vale", "quests"),
      id("items", "oil"),
    );
  assert.equal(
    authoringAction(state).label,
    "Set Vale's starting quest: bring Oil",
  );
  const next = apply(state);
  assert.deepEqual(next.source.pack.avatars.vale.want, {
    kind: "item",
    target: "oil",
  });
  assert.deepEqual(undo(next).source, source);
});

it("keeps source and history intact after stale selections or atomic edits", () => {
  const source = fixture();
  const state = pair(
    createAuthoringState(source),
    id("places", "b", "contents"),
    id("items", "oil"),
  );
  const action = authoringAction(state),
    changed = select(state, id("avatars", "vale"));
  assert.throws(
    () => reduceAuthoring(changed, { type: "apply", ...action }),
    /selection changed/,
  );
  assert.throws(
    () => reduceAuthoring(apply(state), { type: "apply", ...action }),
    /draft changed/,
  );
  const edit = linkPlaces(source, "a", "b");
  const current = createAuthoringState(source);
  current.source.pack.places.b.exits = ["a"];
  const before = JSON.stringify(current);
  assert.throws(
    () => reduceAuthoring(current, { type: "edit", edit }),
    /changed/,
  );
  assert.equal(JSON.stringify(current), before);
  const updated = reduceAuthoring(state, {
    type: "edit",
    edit: sourceEdit(state.source, "Edit hint", [
      { path: ["pack", "places", "a", "text"], value: "A quiet yard." },
    ]),
  });
  assert.deepEqual(undo(updated).source, source);
  assert.equal(updated.armed, null);
});

it("switches and cancels arms explicitly and shows guards for invalid targets", () => {
  const source = fixture();
  source.pack.items.oil.regrow = "dawn";
  const state = pair(
    createAuthoringState(source),
    id("avatars", "vale", "contents"),
    id("items", "oil"),
  );
  assert.match(authoringAction(state).reason, /location/);
  const next = reduceAuthoring(state, {
    type: "arm",
    id: id("places", "b", "quests"),
  });
  assert.equal(next.selected.length, 1);
  assert.match(
    authoringAction(select(next, id("items", "oil"))).reason,
    /conditions and rewards/,
  );
  const cancelled = reduceAuthoring(next, { type: "cancel" });
  assert.equal(authoringAction(cancelled), null);
  assert.strictEqual(undo(cancelled), cancelled);
  assert.deepEqual(
    reduceAuthoring(cancelled, { type: "setLaunch", place: "b" }).source.launch,
    { schemaVersion: 1, place: "b" },
  );
});
