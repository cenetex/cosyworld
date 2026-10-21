// First-time pairing tips. The first time a gift, a trade, or a shared
// journey can be played, the hand names the pair once. Playing that kind of
// pair, or dismissing the tip, retires it for this browser.
import { availableCards, cardPlay } from "./cards.mjs";
import { legalActions, nameOf } from "./world.mjs";

export const LESSONS = ["give", "trade", "accompany"];

const tipText = {
  give: (a) =>
    `Pair the ${nameOf(a.item)} with ${nameOf(a.target)} to give it.`,
  trade: (a) =>
    `Pair the ${nameOf(a.item)} with the ${nameOf(a.receive)} to trade.`,
  accompany: (a) =>
    `Pair ${nameOf(a.target)} with ${nameOf(a.destination)} to travel together.`,
};

// The tip to show now, or null: the first unlearned kind with a pair in hand
// that plays as that action.
export function nextLesson(world, learned) {
  const hand = availableCards(world);
  const actions = legalActions(world).filter(
    (a) =>
      a.actor === "vale" &&
      LESSONS.includes(a.kind) &&
      !learned.has(a.kind) &&
      a.cards?.length === 2 &&
      a.cards.every((id) => hand.includes(id)) &&
      cardPlay(world, a.cards).action?.key === a.key,
  );
  for (const kind of LESSONS) {
    const action = actions.find((a) => a.kind === kind);
    if (action)
      return { kind, cards: [...action.cards], text: tipText[kind](action) };
  }
  return null;
}
