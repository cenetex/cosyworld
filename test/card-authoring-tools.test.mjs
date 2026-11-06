import { expect, it } from "vitest";
import { authoringTools } from "../v2/card-game/authoring-tools.mjs";
import { WORLD, TOOLS } from "../v2/card-game/authoring-collections.mjs";
const base = () => ({
  world: [
    { id: WORLD, name: "World", holder: null },
    ...["items", "avatars", "places"].map((id) => ({ id, holder: WORLD })),
    {
      id: "dino",
      holder: "avatars",
      source: ["pack", "avatars", "sample-vale"],
    },
  ],
  tools: [{ id: TOOLS, holder: null }],
});
it("anchors actions and nests selectable candidates without changing source identities", () => {
  const input = base(),
    before = structuredClone(input);
  const view = authoringTools(input, [
    { id: "seed", anchor: WORLD },
    { id: "portrait", anchor: "dino" },
    {
      id: "candidate",
      holder: "avatars",
      name: "Lumi",
      kind: "avatar",
      art: "blob:verified-image",
      state: "Suggested",
      selected: true,
    },
    { id: "poses", holder: "designer-tool-candidate" },
    { id: "source", name: "World notes" },
  ]);
  expect(input).toEqual(before);
  expect(
    view.cards.world.filter((c) => c.holder === WORLD).map((c) => c.id),
  ).toEqual(["items", "avatars", "places"]);
  expect(view.anchors.get(WORLD)).toBe("designer-tool-seed");
  expect(view.locations.get("designer-tool-portrait")).toEqual({
    mode: "world",
    cardId: "dino",
  });
  expect(view.locations.get("designer-tool-poses").mode).toBe("world");
  expect(
    view.cards.world.find((c) => c.id === "designer-tool-candidate"),
  ).toMatchObject({
    kind: "avatar",
    art: "blob:verified-image",
    state: "Suggested",
    group: true,
  });
  expect(view.cards.world.find((c) => c.id === "dino").source).toEqual(
    before.world[4].source,
  );
  expect(view.cards.tools.at(-1).holder).toBe(TOOLS);
  expect(view.selected).toEqual(["designer-tool-candidate"]);
});
it.each([
  [{ id: "one", holder: "missing" }],
  [{ id: "one", holder: WORLD }],
  [
    { id: "one", holder: "designer-tool-two" },
    { id: "two", holder: "designer-tool-one" },
  ],
  [
    { id: "one", anchor: WORLD },
    { id: "two", anchor: WORLD },
  ],
  [
    { id: "one", anchor: WORLD },
    { id: "two", anchor: "designer-tool-one" },
  ],
  [{ id: "one", anchor: WORLD, holder: "avatars" }],
  [{ id: "one" }, { id: "one" }],
  [{}],
])("rejects an unreachable or ambiguous tool tree: %j", (...tools) => {
  expect(() => authoringTools(base(), tools)).toThrow();
});
