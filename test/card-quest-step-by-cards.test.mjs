import { describe, expect, it } from "vitest";
import { availableCards, cardActions } from "../v2/card-game/cards.mjs";
import { createWorld } from "../v2/card-game/world.mjs";
import { questStep } from "../v2/card-game/quest-step.mjs";
import { questCard } from "../v2/card-game/quest-card.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

// A held quest's one button is Discard (owner, 2026-11-11), so each step the
// quest card used to offer must be a play some ordinary card selection offers.
const quest = (kind, target, step = null) => ({
  actor: "vale",
  kind,
  target,
  step,
});
// Every single card and pair of the cards a step names, with its place.
function selections(world, action) {
  const named = [action?.item, action?.target, action?.destination]
    .concat(world.actors.vale.place)
    .filter((id, i, all) => id && all.indexOf(id) === i)
    .filter((id) => availableCards(world).includes(id));
  const out = named.map((c) => [c]);
  for (const x of named) for (const y of named) if (x < y) out.push([x, y]);
  return out;
}
// The selection whose play is the step's, or null.
const byCards = (world, action) =>
  selections(world, action).find((sel) =>
    cardActions(world, sel).actions.some(
      (a) =>
        a.kind === action.kind &&
        (a.item ?? null) === (action.item ?? null) &&
        (a.target ?? null) === (action.target ?? null) &&
        (a.destination ?? null) === (action.destination ?? null),
    ),
  ) ?? null;

describe("a quest's step, by choosing its cards", () => {
  it("move, give, take and Hollow rites", () => {
    const s = createWorld();
    s.actors.vale.place = "station";
    s.actors.vale.visited.push("pond");
    s.crossings["pond-greek-harbor"].discovered = true;
    const move = questStep(s, quest("place", "pond"), false).action;
    expect(byCards(s, move)).not.toBe(null);

    const g = createWorld();
    g.actors.vale.place = "pond";
    g.items.oil.holder = "vale";
    g.actors.keeper.want = {
      kind: "item",
      target: "oil",
      since: 0,
      refusals: 0,
    };
    const give = questStep(
      g,
      quest("item", "oil", { verb: "give", to: "keeper" }),
      false,
    ).action;
    expect(byCards(g, give)).not.toBe(null);
    const bring = questStep(
      g,
      quest("item", "oil", { verb: "bring", at: "station" }),
      false,
    ).action;
    expect(byCards(g, bring)).not.toBe(null);

    const { beforeAnoint, anointed, veiled } = funeralJourney();
    for (const world of [beforeAnoint, anointed, veiled]) {
      const lay = questStep(world, questCard(world), false).action;
      expect(byCards(world, lay)).not.toBe(null);
    }
    const t = createWorld();
    t.actors.vale.place = "pond";
    t.items.oil.holder = "pond";
    t.actors.vale.want = {
      kind: "item",
      target: "oil",
      step: { verb: "bring", at: "pond", to: "keeper" },
      quest: { level: 2, left: 2 },
      since: 0,
      refusals: 0,
    };
    const take = questStep(t, questCard(t), false).action;
    expect(byCards(t, take)).not.toBe(null);
  });

  it("rest where the quest says, and talk to a person", () => {
    const r = createWorld();
    const here = r.actors.vale.place;
    expect(
      questStep(r, quest("place", here, { verb: "rest" }), false),
    ).toEqual({ rest: true });
    const wait = selections(r, null).find((sel) =>
      cardActions(r, sel).actions.some((a) => a.kind === "wait"),
    );
    expect(wait).toBeTruthy();
    const s = createWorld();
    s.actors.vale.place = "pond";
    const talk = questStep(s, quest("person", "moth"), false);
    if (talk?.action) expect(byCards(s, talk.action)).not.toBe(null);
  });
});
