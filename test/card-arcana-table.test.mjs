import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import {
  bindingOf,
  dealable,
  deck,
  recordOf,
  settleArcana,
} from "../v2/card-game/world/arcana.mjs";
import { arcanaCards, nameOf, things } from "../v2/card-game/world/catalog.mjs";
import { createWorld } from "../v2/card-game/world.mjs";

const READERS = ["carried", "visited", "heard", "trusting", "opened"];
const conditions = (list) =>
  list.flatMap((c) => [
    c,
    ...conditions(c.conditions || (c.condition ? [c.condition] : [])),
  ]);
const all = (card) => conditions(card.proof);
const counts = (card) => all(card).filter((c) => c.kind === "count");

afterEach(() => {
  deck.cards = data.cards;
});

describe("the table of cards", () => {
  it("binds and deals every card in a fresh world, proved by no deal", () => {
    for (const seed of [3, 7, 11]) {
      const s = createWorld({ seed });
      for (const card of data.cards) {
        const binding = bindingOf(s, card, "vale");
        expect(binding, `${card.id} seed ${seed}`).not.toBeNull();
        expect(dealable(s, card, "vale"), `${card.id} seed ${seed}`).toBe(true);
        deck.cards = [card];
        const t = createWorld({ seed });
        settleArcana(t, "vale");
        settleArcana(t, "vale");
        expect(recordOf(t, "vale"), `${card.id} seed ${seed}`).toMatchObject({
          dealt: card.id,
          proved: [],
        });
      }
    }
  });

  it("asks of every card something done after the deal", () => {
    for (const card of data.cards)
      expect(
        all(card).some(
          (c) =>
            c.kind === "did" || (c.kind === "count" && c.min !== undefined),
        ),
        card.id,
      ).toBe(true);
  });

  it("gives every count a known reader and one bound", () => {
    for (const card of data.cards)
      for (const c of counts(card)) {
        expect(READERS, card.id).toContain(c.of);
        expect((c.min === undefined) !== (c.max === undefined), card.id).toBe(
          true,
        );
        expect(c.min ?? c.max).toBeTypeOf("number");
      }
  });

  it("never gives one card two rising counts of the same kind", () => {
    for (const card of data.cards) {
      const rising = counts(card)
        .filter((c) => c.min !== undefined)
        .map((c) => c.of);
      expect(new Set(rising).size, card.id).toBe(rising.length);
    }
  });

  it("gives every card with a deed a desire to say", () => {
    for (const card of data.cards)
      if (all(card).some((c) => c.kind === "did"))
        expect(card.desire?.length, card.id).toBeGreaterThan(0);
  });

  it("keeps the cards out of the things and still names them", () => {
    for (const card of data.cards) {
      expect(things[card.id]).toBeUndefined();
      expect(arcanaCards[card.id]).toBe(card);
      expect(nameOf(card.id)).toBe(card.name);
    }
  });
});
