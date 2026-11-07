import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { questScreen } from "../v2/card-game/quest-screen.mjs";

// Just enough of the DOM for the quest card's screen.
const element = () => ({
  className: "",
  dataset: {},
  children: [],
  append(...nodes) {
    this.children.push(...nodes);
  },
});
const art = {
  url: (src) => src,
  portrait: (id) => `${id}.webp`,
  thing: (id) => `${id}.webp`,
  place: (id) => `${id}.webp`,
};
const parts = (screen) =>
  screen.children.map((img) => `${img.className}:${img.src}`);

describe("the quest card's screen", () => {
  beforeEach(() => {
    globalThis.document = { createElement: element };
  });
  afterEach(() => {
    delete globalThis.document;
  });

  const bring = {
    verb: "Bring",
    actor: "orin",
    kind: "item",
    target: "board",
    covered: false,
  };

  it("shows the carved box for a home not yet found, not the place here", () => {
    const screen = questScreen({ ...bring, here: null, atCovered: true }, art);
    expect(screen.dataset.parts).toBe("3");
    expect(parts(screen)).toEqual([
      "quest-figure quest-left:orin.webp",
      "quest-thing:board.webp",
      "quest-back quest-right quest-to:./assets/card-back.webp",
    ]);
  });

  it.each([
    [{ kind: "place", target: "gate", covered: true }, "gate"],
    [{ ...bring, target: "gift", covered: true }, "gift"],
    [{ ...bring, to: "moth", toCovered: true }, "moth"],
    [{ ...bring, at: "home", atCovered: true }, "home"],
  ])("uses the target's actual lock for a closed miniature", (view, locked) => {
    const screen = questScreen(view, {
      ...art,
      back: (id) => id === locked ? "locked.webp" : "plain.webp",
    });
    expect(parts(screen).some((part) => part.endsWith(":locked.webp"))).toBe(true);
    expect(screen.children.some((img) => img.dataset.entity === locked)).toBe(false);
  });

  it("shows a found home as the card's ground", () => {
    const screen = questScreen({ ...bring, here: "pavilion" }, art);
    expect(screen.dataset.parts).toBeUndefined();
    expect(parts(screen)[0]).toBe("quest-ground:pavilion.webp");
  });

  it.each([
    { ...bring, here: null, atCovered: true },
    { actor: "orin", kind: "place", target: "pavilion", covered: true },
    { ...bring, to: "moth", hereCovered: true },
  ])("keeps an unknown action destination behind the wooden box", (view) => {
    const screen = questScreen(
      view,
      {
        ...art,
        place: () => {
          throw new Error("The hidden place's image was requested");
        },
      },
      true,
    );
    expect(parts(screen)[0]).toBe("quest-ground:./assets/card-back.webp");
    expect(screen.children.some((img) => img.dataset.entity === "orin")).toBe(
      true,
    );
    expect(
      screen.children.some((img) => img.dataset.entity === "pavilion"),
    ).toBe(false);
  });

  it("places a recipe's maker and ingredients within its home", () => {
    const screen = questScreen(
      {
        ...bring,
        actor: "myrto",
        here: "dock",
        items: ["bread", "figs", "wine"],
      },
      art,
    );
    expect(screen.children.map((img) => img.dataset.entity)).toEqual([
      "dock",
      "myrto",
      "bread",
      "figs",
      "wine",
    ]);
  });
  it("shows the box for an unknown recipient, as before", () => {
    const screen = questScreen(
      { ...bring, verb: "Give", to: "moth", toCovered: true },
      art,
    );
    expect(parts(screen).at(-1)).toBe(
      "quest-back quest-right quest-to:./assets/card-back.webp",
    );
  });
});
