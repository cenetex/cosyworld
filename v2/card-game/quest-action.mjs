import { discardable } from "./quest-card.mjs";
import { playLabel, playText } from "./cards.mjs";

export function pickedQuestAction(quest, legal, revision, confirmation) {
  if (!quest) return null;
  const accept = quest.turnable ? "Turn over" : quest.face === "reward" ? "Collect" : null;
  const action = legal.find((offer) => offer.tarot === quest.index && (accept
    ? offer.kind === "accept" && offer.label === accept
    : discardable(quest) && offer.kind === "drop" && !offer.item));
  if (!action) return null;
  const confirmKey = accept ? null : `${revision}:${quest.key}`;
  const confirming = confirmKey !== null && confirmation === confirmKey;
  return {
    action, confirmKey,
    label: confirming ? "Confirm?" : playLabel(action),
    tap: accept ?? (confirming ? "Confirm" : "Discard"),
    title: accept ? playText(action) : "Discard this quest",
  };
}
