import { afterEach, describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { LOCKED_BOX, lockWords } from "../v2/card-game/cards.mjs";
import {
  latchingRoute,
  packDefinitions,
} from "../v2/card-game/pack-registry.mjs";
import { questCaption, questVerb } from "../v2/card-game/quest-card.mjs";
import {
  bindingOf,
  deck,
  recordOf,
  settleArcana,
} from "../v2/card-game/world/arcana.mjs";
import {
  boxDefs,
  boxesAt,
  shutBoxesAt,
} from "../v2/card-game/world/boxes.mjs";
import { nameOf } from "../v2/card-game/world/catalog.mjs";
import {
  createWorld,
  decodeSave,
  humanAvatarIds,
  validateWorld,
} from "../v2/card-game/world.mjs";

const CARD = data.cards[0].id;
const never = [{ kind: "count", of: "visited", min: 99 }];
const MEAL = {
  id: CARD,
  number: 0,
  roles: [
    { name: "thing", kind: "item", is: "food" },
    { name: "someone", kind: "resident" },
  ],
  proof: never,
  desire: [
    { kind: "item", target: "$thing", step: { verb: "eat", with: "$someone" } },
  ],
};
const boxOf = (s, place, who = "vale") =>
  boxesAt(s, place, who).find((box) => box.id === CARD);

function world(card = { id: CARD, number: 0, proof: never }, options = {}) {
  deck.cards = [card];
  const s = createWorld({ seed: 5, ...options });
  s.items[CARD].holder = s.actors.vale.place;
  return s;
}

afterEach(() => {
  deck.cards = data.cards;
});

describe("a shut card is a locked box", () => {
  it("lies shut at its place for a traveler, and nowhere else", () => {
    const s = world();
    const here = s.actors.vale.place;
    expect(boxOf(s, here)).toEqual({
      id: CARD,
      kind: "item",
      at: here,
      open: false,
      want: null,
      goals: [],
    });
    expect(shutBoxesAt(s, here, "vale").map((box) => box.id)).toContain(CARD);
    const other = s.items[data.cards[1].id].holder;
    expect(other).not.toBe(here);
    expect(boxOf(s, other)).toBeUndefined();
    expect(boxDefs().some((def) => def.id === CARD)).toBe(false);
    expect(() => validateWorld(s)).not.toThrow();
  });

  it("is not a box once proved, once held, or for a resident", () => {
    const s = world();
    const here = s.actors.vale.place;
    s.actors.vale.arcana = { proved: [CARD], held: [], did: [] };
    expect(boxOf(s, here)).toBeUndefined();
    s.actors.vale.arcana.held = [CARD];
    expect(boxOf(s, here)).toBeUndefined();
    const other = humanAvatarIds.find((id) => id !== "vale");
    expect(boxOf(s, here, other)).toBeDefined();
    const resident = Object.keys(s.actors).find(
      (id) => !humanAvatarIds.includes(id),
    );
    expect(boxOf(s, here, resident)).toBeUndefined();
  });

  it("waits until the opening is crossed", () => {
    const s = world(undefined, { opening: true });
    const here = s.actors.vale.place;
    expect(s.opening.crossed).toBe(false);
    expect(boxOf(s, here)).toBeUndefined();
    s.opening.crossed = true;
    expect(boxOf(s, here)).toBeDefined();
  });
});

describe("the words on a shut card", () => {
  it("are the card's desire with its roles filled", () => {
    const s = world(MEAL);
    const { thing, someone } = bindingOf(s, MEAL, "vale");
    const goal = { kind: "item", target: thing, step: { verb: "eat", with: someone } };
    const box = boxOf(s, s.actors.vale.place);
    expect(box.goals).toEqual([goal]);
    expect(box.want).toEqual(goal);
    const quest = { actor: "vale", ...goal };
    const all = () => true;
    const said = lockWords(s, CARD, all);
    expect(said).toBe(questCaption(quest, false, questVerb(s, quest), all));
    expect(said).toContain(nameOf(thing));
    expect(said).toContain(nameOf(someone));
  });

  it("name nothing the traveler has not discovered", () => {
    const s = world(MEAL);
    const { thing, someone } = bindingOf(s, MEAL, "vale");
    const said = lockWords(s, CARD);
    expect(said).not.toBe(LOCKED_BOX);
    expect(said).not.toContain(nameOf(thing));
    expect(said).not.toContain(nameOf(someone));
  });

  it("say only that it is shut when the card has no desire", () => {
    expect(lockWords(world(), CARD)).toBe(LOCKED_BOX);
  });

  it("shows at most three wants", () => {
    const s = world({ ...MEAL, desire: Array(5).fill(MEAL.desire[0]) });
    expect(boxOf(s, s.actors.vale.place).goals).toHaveLength(3);
  });
});

describe("a card whose role cannot be filled", () => {
  it("is left out: no box, never proved", () => {
    const card = {
      id: CARD,
      number: 0,
      roles: [{ name: "place", kind: "place", is: "food" }],
      proof: [{ kind: "count", of: "visited", min: 0 }],
      desire: [{ kind: "place", target: "$place" }],
    };
    const s = world(card);
    expect(bindingOf(s, card, "vale")).toBeNull();
    expect(boxOf(s, s.actors.vale.place)).toBeUndefined();
    expect(recordOf(settleArcana(s, "vale"), "vale").proved).toEqual([]);
  });
});

describe("a world that opened something the content no longer has", () => {
  const route = packDefinitions
    .flatMap((pack) => pack.routes || [])
    .map((r) => `${r.from}>${r.to}`)
    .filter(latchingRoute)
    .sort()[0];
  const box = boxDefs()[0].id;

  it("drops the gone latches on load and keeps the real ones", () => {
    const s = createWorld({ seed: 5 });
    s.openedRoutes = [route, "item:gone-thing"].sort();
    s.opened = { [box]: ["vale"], "gone-thing": ["vale"] };
    expect(() => validateWorld(s)).toThrow();
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.openedRoutes).toEqual([route]);
    expect(loaded.opened).toEqual({ [box]: ["vale"] });
  });

  it("removes a list that ends empty", () => {
    const s = createWorld({ seed: 5 });
    s.openedRoutes = ["item:gone-thing"];
    s.opened = { "gone-thing": ["vale"] };
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.openedRoutes).toBeUndefined();
    expect(loaded.opened).toBeUndefined();
  });
});

describe("the packs", () => {
  it("author no arcanum of their own", () => {
    const ids = packDefinitions.flatMap((pack) => Object.keys(pack.items || {}));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.includes("arcanum"))).toEqual([]);
  });
});
