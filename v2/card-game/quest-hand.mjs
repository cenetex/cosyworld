// A resident's quest card lies behind them, face up once you know its fact.
import { imageUrl } from "./images.mjs";
import { LOCKED_BACK } from "./locked-box.mjs";
import { offerCard, offerWords, questTier } from "./quest-card.mjs";
import { toldWant } from "./talk-quest.mjs";
import { lockedOffer, people } from "./world.mjs";

export function tableQuest(world, viewer, owner) {
  if (!people[owner] || owner === viewer) return null;
  const up = toldWant(world, viewer, owner),
    quest = up ? offerCard(world, viewer, null, owner) : null;
  return quest || (!up && lockedOffer(world, viewer, owner))
    ? { id: `offer:${owner}`, owner, quest }
    : null;
}

export const tableQuests = (world, viewer, ids) =>
  ids.map((owner) => tableQuest(world, viewer, owner)).filter(Boolean);

export function besideOwners(cards, entries) {
  const hand = [...cards];
  for (const { id, owner } of entries) {
    const at = hand.indexOf(owner) + 1;
    if (at) hand.splice(at, 0, id);
  }
  return hand;
}

const faceArt = (quest, art, covered) =>
  covered
    ? art.back(quest.target)
    : quest.kind === "item"
      ? art.thing(quest.target)
      : quest.kind === "place"
        ? art.place(quest.target)
        : art.portrait(quest.target);

export function syncTableFold(fold, world, table, view) {
  const quest = table?.quest;
  fold.hidden = !table || view.open;
  if (!table) return;
  fold.dataset.face = quest ? "up" : "down";
  const src = quest
    ? faceArt(quest, view.art, view.covered(quest))
    : LOCKED_BACK;
  fold.style.setProperty("--card-back", `url("${imageUrl(src, "card")}")`);
  if (quest)
    fold.style.setProperty(
      "--tier-color",
      questTier(quest, world, view.known).color,
    );
  else fold.style.removeProperty("--tier-color");
  fold.setAttribute(
    "aria-label",
    quest
      ? `${offerWords(quest, view.known)}. Open it.`
      : `${view.name(table.owner, "Someone")}'s quest, face down until you talk`,
  );
}
