import { routeAlternativesFixture } from "./helpers/authoring-route-alternatives.mjs";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applySourceEdit } from "../v2/card-game/authoring-edits.mjs";
import {
  addItemOpening,
  changeOpeningRequirements,
  changeLaneRequirements,
} from "../v2/card-game/authoring-quests.mjs";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const greek = () => ({
  pack: read("v2/content/greek-drama/card-world.json"),
  bridge: read("v2/worlds/greek-drama/card-bridge.json"),
});
const small = () => ({
  pack: {
    places: { a: { name: "A", exits: ["b"] }, b: { name: "B", exits: ["a"] } },
    items: { oil: { name: "Oil", holder: "a" } },
  },
  bridge: {},
});
const apply = (source, edit) => {
  const before = JSON.stringify(source),
    result = applySourceEdit(source, edit);
  expect(JSON.stringify(source)).toBe(before);
  expect(
    JSON.stringify(applySourceEdit(result.source, result.undo).source),
  ).toBe(before);
  return result.source;
};

describe("authored opening and voyage quests", () => {
  it.each([true, false])(
    "turns a walk into an item quest, carried=%s",
    (carried) => {
      const source = small();
      const next = apply(
        source,
        addItemOpening(source, { from: "a", to: "b", item: "oil", carried }),
      );
      expect(next.pack.places.a.exits).toEqual([]);
      expect(next.pack.places.b.exits).toEqual(["a"]);
      expect(next.pack.routes).toEqual([
        {
          from: "a",
          to: "b",
          requires: [
            {
              kind: carried ? "item_present" : "item_at",
              item: "oil",
              place: "a",
            },
          ],
        },
      ]);
    },
  );
  it("keeps three route alternatives and their sealed quests", () => {
    const { source, indices } = routeAlternativesFixture(greek()),
      routes = source.pack.routes;
    expect(indices).toHaveLength(3);
    const i = indices[1],
      next = apply(
        source,
        changeOpeningRequirements(
          source,
          i,
          routes[i].requires.slice().reverse(),
        ),
      );
    expect(next.pack.routes[i]).toEqual({
      ...routes[i],
      requires: routes[i].requires.slice().reverse(),
    });
    routes.forEach((r, j) => {
      if (j !== i) expect(next.pack.routes[j]).toEqual(r);
    });
    expect(next.pack.choices).toEqual(source.pack.choices);
    expect(next.pack.avatars["greek-antigone"].want).toEqual(
      source.pack.avatars["greek-antigone"].want,
    );
  });
  it("removes a direct bypass atomically and refuses a stale gate update", () => {
    const source = small();
    source.pack.routes = [
      {
        from: "a",
        to: "b",
        live: true,
        sealed: { quest: { kind: "item", target: "oil" } },
      },
    ];
    const edit = changeOpeningRequirements(source, 0, [
      { kind: "item_at", item: "oil", place: "a" },
    ]);
    const next = apply(source, edit);
    expect(next.pack.places.a.exits).toEqual([]);
    expect(next.pack.routes[0].sealed).toEqual(source.pack.routes[0].sealed);
    const stale = structuredClone(source);
    stale.pack.routes[0].requires = [];
    const before = JSON.stringify(stale);
    expect(() => applySourceEdit(stale, edit)).toThrow(/changed/);
    expect(JSON.stringify(stale)).toBe(before);
  });
  it("edits Charybdis cargo conditions and retains its ordered lanes and home", () => {
    const source = greek(),
      ship = source.bridge.transports["greek-ship"];
    const index = ship.lanes.findIndex((lane) => lane.opensWith);
    const conditions = [
      { kind: "item_at", item: "greek-provisions", place: "greek-ship" },
    ];
    const next = apply(
      source,
      changeLaneRequirements(source, "greek-ship", index, conditions),
    );
    const changed = next.bridge.transports["greek-ship"];
    expect(changed.at).toBe(ship.at);
    expect(changed.docks).toEqual(ship.docks);
    ship.lanes.forEach((lane, i) =>
      expect(changed.lanes[i]).toEqual(
        i === index ? { ...lane, opensWith: conditions } : lane,
      ),
    );
    expect(next.bridge.crossings).toEqual(source.bridge.crossings);
  });
  it("keeps a free way home and directs deck links to the ship editor", () => {
    const source = greek(),
      ship = source.bridge.transports["greek-ship"];
    const home = ship.lanes.findIndex((lane) => lane.to === ship.at);
    expect(() =>
      changeLaneRequirements(source, "greek-ship", home, [
        { kind: "item_at", item: "greek-provisions", place: "greek-ship" },
      ]),
    ).toThrow();
    expect(() =>
      addItemOpening(source, {
        from: "greek-ship",
        to: "greek-harbor",
        item: "greek-provisions",
      }),
    ).toThrow(/ship/);
    const approach = source.pack.routes.find((route) => route.sealed);
    expect(() =>
      addItemOpening(source, {
        from: approach.from,
        to: approach.to,
        item: "greek-provisions",
      }),
    ).toThrow(/existing/);
  });
  it("clears a voyage gate and restores its locked card with Undo", () => {
    const source = greek(),
      ship = source.bridge.transports["greek-ship"];
    const index = ship.lanes.findIndex((lane) => lane.sealed);
    const next = apply(
      source,
      changeLaneRequirements(source, "greek-ship", index, []),
    );
    const rest = { ...ship.lanes[index] };
    delete rest.opensWith;
    delete rest.sealed;
    expect(next.bridge.transports["greek-ship"].lanes[index]).toEqual(rest);
  });
  it("clears an opening quest and restores the sealed card with Undo", () => {
    const source = greek(),
      index = source.pack.routes.findIndex((r) => r.sealed);
    const next = apply(source, changeOpeningRequirements(source, index, []));
    expect(next.pack.routes[index].requires).toEqual([]);
    expect(next.pack.routes[index].sealed).toBeUndefined();
    source.pack.routes.forEach((r, i) => {
      if (i !== index) expect(next.pack.routes[i]).toEqual(r);
    });
  });
});
