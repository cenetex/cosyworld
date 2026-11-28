import { currentActor, carried, nameOf, standoffFor } from "./world.mjs";
import { humanAvatar } from "./human-cast.mjs";
import { avatarImage } from "./scarves.mjs";
import { levelOf } from "./want.mjs";
import { levelTier, romanLevel } from "./rarity.mjs";
import { arcanaCards } from "./world/catalog.mjs";
import { recordOf, unlockedOf } from "./world/arcana-record.mjs";
import { homeOf } from "./world/home.mjs";
import { arcanumArt } from "./glimpse-card.mjs";
import { TAROT_BACK, TAROT_LOCKED_BACK } from "./locked-box.mjs";
import { levelCards, questCards, questCaption, questHeading } from "./quest-card.mjs";
import { MAX_RESOLVE } from "./combat-beats.mjs";
import { imageUrl } from "./images.mjs";
import { availableCards } from "./cards.mjs";
import { notBehindOwners, tableQuests } from "./quest-hand.mjs";
import { greekJournal } from "./greek-journal.mjs";

export function characterSheet(world, { known = () => false, withheldTarot, caption = (text) => text } = {}) {
  const actor = currentActor(world), person = world.actors[actor];
  const level = levelOf(world, actor), record = recordOf(world, actor);
  const owned = new Set(unlockedOf(world, actor));
  const spread = new Map(record.spread.filter((_, index) => index !== withheldTarot).map((slot) => [slot.card, slot]));
  const ids = Object.keys(arcanaCards).sort((a, b) => arcanaCards[a].number - arcanaCards[b].number);
  const face = (id) => ({ id, name: nameOf(id), art: arcanumArt(id) });
  const cards = ids.filter((id) => owned.has(id)).map(face);
  const slots = ids.map((id) => {
    const slot = spread.get(id);
    if (!slot) return owned.has(id) ? { ...face(id), state: "collected" } : { state: "unknown" };
    if (["down", "locked"].includes(slot.face))
      return { state: "locked", art: TAROT_LOCKED_BACK };
    if (!owned.has(id) && !known(`tarot:${actor}:${id}`))
      return { state: "unlocked", art: TAROT_BACK };
    return { ...face(id), state: slot.face === "reward" ? "reward" : "active" };
  });
  const resolve = standoffFor(world, actor)?.resolve[actor];
  const label = (id, hidden) => id && known(id) ? caption(nameOf(id)) : hidden;
  const tables = tableQuests(world, actor, availableCards(world).filter(known))
    .filter(({ quest }) => quest && !quest.completed);
  const quests = [...levelCards(world, actor).filter((card) => card.index !== withheldTarot),
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
    total: slots.length,
    cards, slots,
    greek: greekJournal(world, actor, known),
    progress: withheldTarot === undefined && record.need.length
      ? `${record.done.filter((id) => record.need.includes(id)).length} of ${record.need.length} required cards collected`
      : "",
    quests: quests.map((quest) => ({
      key: quest.key,
      heading: quest.offer ? label(quest.offer, "A request")
        : quest.turnable ? "Turn over a tarot card"
        : quest.face === "down" ? "Unlock a tarot card"
        : quest.face === "locked" ? "New tarot quest"
        : quest.face === "reward" ? "Ready to collect"
        : questHeading(quest) || "Quest",
      words: quest.face === "reward" && !known(quest.key) &&
        !unlockedOf(world, actor).includes(quest.target)
        ? ""
        : caption(questCaption(quest, !known(quest.target), null, known)),
    })),
  };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function characterSheetSection(sheet, { viewCard, persona }) {
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
  const deck = element("div", "sheet-deck");
  for (const card of sheet.slots) {
    const tile = element(card.id ? "button" : "div", "sheet-tarot");
    tile.dataset.tarotState = card.state;
    if (card.id) {
      tile.type = "button";
      tile.dataset.tarot = card.id;
      const status = card.state === "reward" ? "Ready to collect" : card.state === "active" ? "In spread" : "Collected";
      tile.title = `${card.name} · ${status}`;
      tile.setAttribute("aria-label", `View ${card.name}`);
      tile.setAttribute("aria-description", status);
      tile.onclick = () => viewCard(card.id, card.art);
    } else if (card.art) {
      tile.setAttribute("role", "img");
      tile.setAttribute("aria-label", card.state === "locked" ? "Locked tarot card" : "Unlocked tarot card");
    } else {
      tile.setAttribute("aria-hidden", "true");
      tile.textContent = "?";
    }
    if (card.art) {
      const art = element("img");
      art.alt = "";
      art.loading = "lazy";
      art.src = imageUrl(card.art, "card");
      tile.append(art);
    }
    deck.append(tile);
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
  root.append(hero);
  if (persona) root.append(persona);
  root.append(facts, tarot, quests);
  if (sheet.greek?.length) {
    const journal = element("section", "sheet-section");
    journal.append(element("h3", "", "Greek plays"));
    for (const story of sheet.greek) {
      const row = element("div", "sheet-quest");
      row.append(element("h4", "", `${story.title} · ${story.author}`));
      const summary = [story.era, story.place, story.account, story.personal, story.settled ? "World decision recorded" : ""].filter(Boolean).join(" · ");
      if (summary) row.append(element("p", "", summary));
      if (story.next) row.append(element("p", "", story.next));
      journal.append(row);
    }
    root.append(journal);
  }
  root.append(items);
  return root;
}
