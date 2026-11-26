import { currentActor, carried, nameOf, standoffFor } from "./world.mjs";
import { humanAvatar } from "./human-cast.mjs";
import { avatarImage } from "./scarves.mjs";
import { levelOf } from "./want.mjs";
import { levelTier, romanLevel } from "./rarity.mjs";
import { arcanaCards } from "./world/catalog.mjs";
import { recordOf, unlockedOf } from "./world/arcana-record.mjs";
import { homeOf } from "./world/home.mjs";
import { arcanumArt } from "./glimpse-card.mjs";
import { levelCards, questCards, questCaption, questHeading } from "./quest-card.mjs";
import { MAX_RESOLVE } from "./combat-beats.mjs";
import { imageUrl } from "./images.mjs";
import { availableCards } from "./cards.mjs";
import { notBehindOwners, tableQuests } from "./quest-hand.mjs";

export function characterSheet(world, { known = () => false } = {}) {
  const actor = currentActor(world), person = world.actors[actor];
  const level = levelOf(world, actor), record = recordOf(world, actor);
  const resolve = standoffFor(world, actor)?.resolve[actor];
  const label = (id, hidden) => id && known(id) ? nameOf(id) : hidden;
  const tables = tableQuests(world, actor, availableCards(world).filter(known))
    .filter(({ quest }) => quest && !quest.completed);
  const quests = [...levelCards(world, actor),
    ...notBehindOwners(questCards(world, actor), () => tables), ...tables.map(({ quest }) => quest)];
  return {
    actor, name: nameOf(actor), title: humanAvatar(actor)?.title || "",
    portrait: avatarImage(world, actor), level, tier: levelTier(level),
    place: label(person.place, "Somewhere unfamiliar"),
    home: label(homeOf(actor, world), "Undiscovered"),
    condition: resolve !== undefined ? `Resolve ${resolve} of ${MAX_RESOLVE}`
      : person.sleeping || person.awake === false ? "Resting" : "Awake",
    visited: new Set((person.visited || []).filter(known)).size,
    items: carried(world, actor).map((id) => label(id, "An unrevealed item")),
    total: Object.keys(arcanaCards).length,
    cards: unlockedOf(world, actor)
      .sort((a, b) => arcanaCards[a].number - arcanaCards[b].number)
      .map((id) => ({ id, name: nameOf(id), art: arcanumArt(id) })),
    progress: record.need.length
      ? `${record.done.filter((id) => record.need.includes(id)).length} of ${record.need.length} required cards collected`
      : "",
    quests: quests.map((quest) => ({
      key: quest.key,
      heading: quest.offer ? label(quest.offer, "A request")
        : quest.face === "down" ? "Unlock a tarot card"
        : quest.face === "locked" ? "New tarot quest"
        : quest.face === "reward" ? "Ready to collect"
        : questHeading(quest) || "Quest",
      words: quest.face === "reward" && !known(quest.key) &&
        !unlockedOf(world, actor).includes(quest.target)
        ? ""
        : questCaption(quest, !known(quest.target), null, known),
    })),
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function characterSheetSection(sheet, { viewCard }) {
  const root = element("section", "character-sheet");
  root.dataset.actor = sheet.actor;
  root.setAttribute("aria-label", `${sheet.name}'s character sheet`);
  const hero = element("div", "sheet-identity");
  const portrait = element("img", "sheet-portrait");
  portrait.src = imageUrl(`./${sheet.portrait}`, "card");
  portrait.alt = "";
  const identity = element("div");
  const level = element("p", "sheet-level", `Level ${sheet.level ? romanLevel(sheet.level) : "0"} · ${sheet.tier.label}`);
  level.style.color = sheet.tier.color;
  identity.append(level, element("h3", "sheet-name", sheet.name),
    element("p", "sheet-title", sheet.title), element("p", "sheet-note", sheet.place));
  hero.append(portrait, identity);
  const facts = element("dl", "sheet-facts");
  for (const [label, value] of [["Condition", sheet.condition], ["Places visited", sheet.visited], ["Home", sheet.home]]) {
    const fact = element("div");
    fact.append(element("dt", "", label), element("dd", "", String(value)));
    facts.append(fact);
  }
  const tarot = element("section", "sheet-section");
  tarot.setAttribute("aria-label", "Tarot collection");
  const heading = element("div", "sheet-heading");
  heading.append(element("h3", "", "Tarot collection"),
    element("span", "sheet-count", `${sheet.cards.length} / ${sheet.total}`));
  tarot.append(heading);
  if (!sheet.cards.length) tarot.append(element("p", "sheet-note", "No cards yet."));
  const deck = element("div", "sheet-deck");
  for (const card of sheet.cards) {
    const button = element("button", "sheet-tarot");
    button.type = "button";
    button.dataset.tarot = card.id;
    button.setAttribute("aria-label", `View ${card.name}`);
    button.onclick = () => viewCard(card.id, card.art);
    const art = element("img");
    art.alt = "";
    art.loading = "lazy";
    art.src = imageUrl(card.art, "card");
    button.append(art, element("span", "", card.name));
    deck.append(button);
  }
  tarot.append(deck);
  const quests = element("section", "sheet-section");
  quests.setAttribute("aria-label", "Current quests");
  quests.append(element("h3", "", "Current quests"));
  if (sheet.progress) quests.append(element("p", "sheet-note", sheet.progress));
  if (!sheet.quests.length) quests.append(element("p", "sheet-note", "No active quests."));
  for (const quest of sheet.quests) {
    const row = element("div", "sheet-quest");
    row.append(element("h4", "", quest.heading));
    if (quest.words) row.append(element("p", "", quest.words));
    quests.append(row);
  }
  const items = element("section", "sheet-section");
  items.append(element("h3", "", "Carrying"),
    element("p", "sheet-note", sheet.items.length ? sheet.items.join(" · ") : "Empty hands."));
  root.append(hero, facts, tarot, quests, items);
  return root;
}
