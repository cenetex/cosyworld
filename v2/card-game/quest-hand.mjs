// A resident's quest card stacks and fans with its things, face up once known.
import { imageUrl } from "./images.mjs";
import { LOCKED_BACK } from "./locked-box.mjs";
import { tableHolder } from "./mystery-view.mjs";
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

export const tableOwner = (id) => id.slice("offer:".length);

export function besideOwners(cards, entries, world) {
  const hand = [...cards];
  for (const { id, owner } of entries) {
    let at = hand.indexOf(owner) + 1;
    if (!at) continue;
    while (at < hand.length && tableHolder(world, hand[at]) === owner) at++;
    hand.splice(at, 0, id);
  }
  return hand;
}

const downWords = (view, owner) =>
  `${view.name(owner, "Someone")}'s quest, face down until you talk`;

export function tableBack(id, view) {
  const owner = tableOwner(id),
    frame = document.createElement("div"),
    card = document.createElement("button"),
    back = document.createElement("img");
  frame.className = "card-frame want-frame";
  Object.assign(frame.dataset, { want: "locked", questId: id, raised: "false", holder: owner });
  frame.hidden = !view.fanned;
  card.className = "card want-card";
  card.type = "button";
  card.disabled = view.blocked;
  Object.assign(card.dataset, { questId: id, questEntry: `locked:${owner}`, unrevealed: "true", picked: "false" });
  card.setAttribute("aria-pressed", "false");
  card.setAttribute("aria-label", downWords(view, owner));
  Object.assign(back, { className: "card-back", src: imageUrl(LOCKED_BACK, "card"), alt: "", draggable: false });
  card.append(back);
  card.addEventListener("click", view.tap);
  frame.append(card);
  return frame;
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
  fold.hidden = !table || view.fanned;
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
    quest ? `${offerWords(quest, view.known)}. Open it.` : downWords(view, table.owner),
  );
}
