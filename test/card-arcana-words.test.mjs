import { describe, expect, it } from "vitest";
import {
  arcanumTerms,
  bindingOf,
  deck,
} from "../v2/card-game/world/arcana.mjs";
import { arcanumArt, glimpseCompanion } from "../v2/card-game/glimpse-card.mjs";
import { homeOf } from "../v2/card-game/world/home.mjs";
import { conditionWords, UNKNOWN } from "../v2/card-game/world/want-words.mjs";
import { createWorld, nameOf } from "../v2/card-game/world.mjs";

const cards = {
  name: (id) => ({ den: "the Den", bread: "Bread", wren: "Wren" })[id] ?? id,
  kind: (id) => (id === "wren" ? "person" : id === "bread" ? "item" : "place"),
  drink: () => false,
};
const say = (terms, known = () => true, home = "den") =>
  conditionWords(terms, known, { cards, home });
const words = (s, id, known = () => false) =>
  conditionWords(arcanumTerms(s, "vale", id), known, { home: homeOf("vale") });
const cardOf = (id) => deck.cards.find((card) => card.id === id);

describe("the words of a level card", () => {
  it("says each count as something to do", () => {
    expect(say([{ kind: "count", of: "carried", max: 0 }])).toBe(
      "carry nothing",
    );
    expect(say([{ kind: "count", of: "carried", max: 2 }])).toBe(
      "carry no more than two things",
    );
    expect(say([{ kind: "count", of: "visited", min: 1 }])).toBe(
      "visit one new place",
    );
    expect(say([{ kind: "count", of: "heard", min: 21 }])).toBe(
      "hear the wants of twenty-one more people",
    );
    expect(say([{ kind: "count", of: "heard", min: 1 }])).toBe(
      "hear the wants of one more person",
    );
    expect(say([{ kind: "count", of: "trusting", min: 3 }])).toBe(
      "be trusted by three more",
    );
    expect(say([{ kind: "count", of: "trusting", level: 2, min: 3 }])).toBe(
      "be trusted well by three more",
    );
    expect(say([{ kind: "count", of: "trusting", level: 3, min: 1 }])).toBe(
      "be trusted deeply by one more",
    );
    expect(say([{ kind: "count", of: "opened", min: 1 }])).toBe(
      "open a locked box",
    );
    expect(say([{ kind: "count", of: "opened", min: 4 }])).toBe(
      "open four locked boxes",
    );
  });

  it("joins terms with and, and choices with or", () => {
    expect(
      say([
        { kind: "count", of: "carried", max: 0 },
        { kind: "not", condition: { kind: "actor_at", place: "den" } },
        {
          kind: "any",
          conditions: [
            { kind: "actor_at", place: "moor" },
            { kind: "count", of: "heard", min: 2 },
          ],
        },
      ]),
    ).toBe(
      "carry nothing, be away from home and be at moor or hear the wants of two more people",
    );
  });

  it("names home but nothing undiscovered", () => {
    const hidden = () => false;
    expect(say([{ kind: "actor_at", place: "den" }], hidden)).toBe(
      "be at home",
    );
    expect(say([{ kind: "actor_at", place: "moor" }], hidden)).toBe(
      `be at ${UNKNOWN.place}`,
    );
    expect(
      say(
        [
          {
            kind: "item",
            target: "bread",
            step: { verb: "eat", with: "wren" },
          },
        ],
        hidden,
      ),
    ).toBe(`eat ${UNKNOWN.item} with ${UNKNOWN.person}`);
    expect(
      say([
        { kind: "item", target: "bread", step: { verb: "eat", with: "wren" } },
      ]),
    ).toBe("eat Bread with Wren");
  });

  it("has no words for a condition it cannot say", () => {
    expect(say([{ kind: "riddle" }])).toBeNull();
    expect(say([{ kind: "count", of: "visited", max: 3 }])).toBeNull();
    expect(say([{ kind: "all", conditions: [{ kind: "riddle" }] }])).toBeNull();
    expect(say([])).toBeNull();
  });

  it("words the real deck from its conditions", () => {
    const s = createWorld({ seed: 7 });
    expect(words(s, "arcanum-0")).toBe(
      "carry nothing, be away from home and visit six new places",
    );
    expect(words(s, "arcanum-1")).toBe("open a locked box");
    expect(words(s, "arcanum-2")).toBe("hear the wants of three more people");
    expect(words(s, "arcanum-5")).toBe("be trusted well by two more");
    expect(words(s, "arcanum-21")).toBe("rest at home");
  });

  it("words the Empress and the Emperor by their desires, hidden until found", () => {
    const s = createWorld({ seed: 7 });
    expect(words(s, "arcanum-3")).toBe(
      `eat ${UNKNOWN.item} with ${UNKNOWN.person}`,
    );
    expect(words(s, "arcanum-4")).toBe(`rest ${UNKNOWN.place}`);
    const empress = bindingOf(s, cardOf("arcanum-3"), "vale");
    expect(words(s, "arcanum-3", () => true)).toBe(
      `eat ${nameOf(empress.thing)} with ${nameOf(empress.someone)}`,
    );
    const emperor = bindingOf(s, cardOf("arcanum-4"), "vale");
    expect(words(s, "arcanum-4", () => true)).toBe(
      `rest at ${nameOf(emperor.place)}`,
    );
  });

  it("words the second row from its desires, hidden until found", () => {
    const s = createWorld({ seed: 7 });
    const hidden = {
      6: "invite someone and travel with a companion",
      7: `sail ${UNKNOWN.place}`,
      8: "trade something for something",
      9: "walk at night holding a light",
      10: `eat ${UNKNOWN.item} and find something`,
      11: "brace against someone",
      12: "let go of a quest",
      14: `drink ${UNKNOWN.item} with someone`,
      15: `keep ${UNKNOWN.item}`,
      16: "free someone shut away",
      17: "give something to someone",
      18: "walk at night without a light",
      19: "travel with a companion and go home",
      20: "be trusted by five more",
    };
    const shown = {
      7: "sail The Charybdis",
      9: "walk at night holding the lit Lamp",
      10: "eat Dried Figs and find Dried Figs",
      14: "drink Wine Skin with someone",
      15: "keep Lamp",
      18: "walk at night without the lit Lamp",
    };
    for (const [n, text] of Object.entries(hidden))
      expect(words(s, `arcanum-${n}`), n).toBe(text);
    for (const [n, text] of Object.entries(shown))
      expect(
        words(s, `arcanum-${n}`, () => true),
        n,
      ).toBe(text);
    expect(say([{ kind: "place", target: "den" }])).toBe("go home");
    expect(say([{ kind: "item", step: { verb: "give" } }])).toBe(
      "give something to someone",
    );
    expect(say([{ kind: "daylight", phase: "day" }])).toBe("walk by day");
    expect(
      say([{ kind: "count", of: "opened", box: "resident", min: 2 }]),
    ).toBe("free two shut away");
  });

  it("words every card in a fresh world", () => {
    for (const seed of [3, 7, 11]) {
      const s = createWorld({ seed });
      for (const card of deck.cards)
        expect(words(s, card.id), `${card.id} seed ${seed}`).toMatch(/^[a-z]/);
    }
  });

  it("carries the woodcut into the dream, and the card back for a card with none", () => {
    const glimpse = (id) => ({ level: 2, kind: "arcanum", id, at: "den" });
    expect(arcanumArt("arcanum-2")).toBe(
      "./assets/lonely-forest/arcanum-2.png",
    );
    expect(glimpseCompanion(glimpse("arcanum-2")).art).toBe(
      "./assets/lonely-forest/arcanum-2.png",
    );
    expect(glimpseCompanion(glimpse("arcanum-21")).art).toBe(
      "./assets/arcana/arcanum-21.png",
    );
    expect(glimpseCompanion(glimpse("arcanum-13")).art).toBe(
      "./assets/card-back.webp",
    );
    expect(glimpseCompanion(null)).toBeNull();
  });
});
