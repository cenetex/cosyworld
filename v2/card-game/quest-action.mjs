import { discardable } from "./quest-card.mjs";
import { playLabel, playText } from "./cards.mjs";
import { questAction } from "./presentation.mjs";

export function pickedQuestAction(quest, legal, revision, confirmation) {
  if (!quest) return null;
  const action = questAction(
    legal,
    quest.index,
    quest.turnable,
    quest.face === "reward",
    discardable(quest),
  );
  if (!action) return null;
  const accept = action.kind === "accept" ? action.label : null;
  const confirmKey = accept ? null : `${revision}:${quest.key}`;
  const confirming = confirmKey !== null && confirmation === confirmKey;
  return {
    action,
    confirmKey,
    label: confirming ? "Confirm?" : playLabel(action),
    tap: accept ?? (confirming ? "Confirm" : "Discard"),
    title: accept ? playText(action) : "Discard this quest",
  };
}
