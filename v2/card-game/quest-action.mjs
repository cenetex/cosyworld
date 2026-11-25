import { discardable } from "./quest-card.mjs";
import { playLabel, playText } from "./cards.mjs";

export function pickedQuestAction(quest, legal, revision, confirmation) {
  if (!quest) return null;
  const collect = quest.face === "reward";
  const action = legal.find((offer) => offer.tarot === quest.index && (collect
    ? offer.kind === "accept" && offer.label === "Collect"
    : discardable(quest) && offer.kind === "drop" && !offer.item));
  if (!action) return null;
  const confirmKey = collect ? null : `${revision}:${quest.key}`;
  const confirming = confirmKey !== null && confirmation === confirmKey;
  return {
    action, collect, confirmKey,
    label: confirming ? "Confirm?" : playLabel(action),
    tap: collect ? "Collect" : confirming ? "Confirm" : "Discard",
    title: collect ? playText(action) : "Discard this quest",
  };
}
