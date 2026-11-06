import { packDefinitions } from "../card-game/pack-registry.mjs";

// The full suite runs each width of a long journey on its own runner
// (scripts/browser-shards.json). Without COSYWORLD_SMOKE_WIDTHS, run them all.
export function smokeWidths(widths) {
  const only = process.env.COSYWORLD_SMOKE_WIDTHS?.split(",");
  if (!only) return widths;
  const chosen = widths.filter((width) => only.includes(String(width)));
  if (!chosen.length)
    throw new Error(`No journey width among ${only} (has ${widths})`);
  return chosen;
}

export const topicForChoice = (choiceId) =>
  choiceId &&
  packDefinitions
    .flatMap((pack) => pack.topics || [])
    .find((topic) => topic.choiceId === choiceId);

// On phones and tablets the dialogue lies over the hand's foot (#1897), so
// a player taps a card's top, which always shows above it.
export async function tapCard(card) {
  await card.scrollIntoViewIfNeeded();
  const { width } = await card.boundingBox();
  await card.click({ position: { x: width / 2, y: 16 } });
}

// ☰ > Settings is a hand of cards (settings-cards.mjs). A setting lies in
// its group, as a thing lies in a place: the group is fanned open, the
// setting chosen, then its context button (#setting-<card>) pressed `times`
// times: a destructive one takes two. Escape unchooses, then closes.
export async function openSettings(page) {
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  await page.locator("#settings-hand .card").first().waitFor();
}
export async function pressSetting(page, id, times = 1) {
  const card = page.locator(`#settings-hand [data-setting="${id}"]`);
  const frame = card.locator("..");
  if ((await frame.getAttribute("hidden")) !== null) {
    const group = await frame.getAttribute("data-holder");
    await tapCard(page.locator(`#settings-hand [data-setting="${group}"]`));
  }
  if ((await card.getAttribute("aria-pressed")) !== "true") await tapCard(card);
  for (let i = 0; i < times; i++) await page.locator(`#setting-${id}`).click();
}
export async function closeSettings(page) {
  while (await page.locator("#settings-screen[open]").count())
    await page.keyboard.press("Escape");
}

// Signed out, Settings holds New game, which asks again before Vale's local
// table starts over (#1892).
export async function startNewGame(page) {
  await openSettings(page);
  await pressSetting(page, "new-game", 2);
}

// Use the same holder reveal and selection gestures as a player.
export async function revealCard(page, id) {
  const card = page.locator(`#hand [data-card="${id}"]`);
  const frame = card.locator("..");
  const holder = await frame.getAttribute("data-holder");
  if ((await frame.getAttribute("hidden")) !== null) {
    if (!holder) await fanWays(page, frame);
    else if (!(await fanAvatarStack(page, holder))) {
      await tapCard(await revealCard(page, holder));
      await fanAvatarStack(page, holder);
    }
  } else if (
    holder &&
    (await card.getAttribute("aria-expanded")) === "false" &&
    !(await card.evaluate((el) => el.classList.contains("location")))
  )
    await tapCard(card);
  await card.scrollIntoViewIfNeeded();
  // The first tap uncovers; a tap during the reveal only skips it.
  if ((await card.getAttribute("data-unrevealed")) === "true") {
    await tapCard(card);
    await page.waitForFunction(
      (id) =>
        !document.querySelector(`#hand [data-card="${id}"]`)?.dataset.revealing,
      id,
    );
  }
  // The folded top of the ways on fans them before it can be chosen.
  if (!holder && (await wayTop(page).count()) && (await isWayTop(card)))
    await fanWays(page, frame);
  return card;
}
// The ways on stack at the row's right end. The current place has its own
// stack for the things lying there.
const wayTop = (page) =>
  page.locator(
    '#hand > .card-frame:not([hidden], [data-inventory]) > .card.location[aria-expanded="false"]',
  );
const isWayTop = (card) =>
  card.evaluate(
    (el) =>
      el.getAttribute("aria-expanded") === "false" &&
      el.classList.contains("location") &&
      !el.parentElement.hasAttribute("data-inventory"),
  );
// A covered top card is uncovered by its first tap, so tap until they fan.
async function fanWays(page, frame) {
  for (let i = 0; i < 3 && (await wayTop(page).count()); i++) {
    await tapCard(wayTop(page).last());
    await page.waitForFunction(
      () => !document.querySelector("#hand [data-revealing]"),
    );
  }
  return (await frame.getAttribute("hidden")) === null;
}
// The avatar's things lie in a stack beside it, its quests in another; a
// folded stack's top card fans it out (#2256).
async function fanAvatarStack(page, holder) {
  const folded = page.locator(
    `#hand .card-frame[data-holder="${holder}"]:not([hidden], [data-want]) > .card[aria-expanded="false"]:not(.location)`,
  );
  if (!(await folded.count())) return false;
  const top = folded.first();
  const id = await top.getAttribute("data-card");
  await tapCard(top);
  const chosen = page.locator(`#hand [data-card="${id}"]`);
  // Fanning also selects the top card. Lower it before choosing another.
  if ((await chosen.getAttribute("aria-pressed")) === "true")
    await tapCard(chosen);
  return true;
}
// A held item stays raised through plays and new targets (#1417, #1435), so
// a scripted step that names its own cards first lowers it, as Escape does.
export async function clearSelection(page) {
  if (await page.locator('#hand .card[aria-pressed="true"]').count())
    await page.keyboard.press("Escape");
}
// A battle locks its room until a round passes without a Strike, so a
// scripted walk waits it out by playing the place card (Wait). Residents
// nobody is striking wait too, which ends it.
export async function endStandoff(page, world, actor = "vale") {
  if (!world.standoffs?.some((c) => Object.hasOwn(c.resolve, actor)))
    return false;
  await clearSelection(page);
  await selectCard(page, world.actors[actor].place);
  await page.locator('#card-actions [data-action="wait"]').click();
  return true;
}
export async function selectCard(page, id, { touch = false } = {}) {
  const frame = page.locator(`#hand [data-card="${id}"]`).locator("..");
  const wasSelected =
    (await frame.locator(".card").getAttribute("aria-pressed")) === "true";
  const holder =
    (await frame.getAttribute("hidden")) !== null
      ? await frame.getAttribute("data-holder")
      : null;
  const card = await revealCard(page, id);
  if (wasSelected || (await card.getAttribute("aria-pressed")) !== "true") {
    if (touch) await card.tap();
    else await card.click();
  }
  // A rested held card first opens its details; this helper's toggle lowers it.
  if (wasSelected && (await card.getAttribute("aria-pressed")) === "true") {
    if (touch) await card.tap();
    else await card.click();
  }
  // Keep the chosen child raised while returning its browsing avatar to the stack.
  if (holder) {
    const owner = page.locator(`#hand [data-card="${holder}"]`);
    if (
      (await owner.getAttribute("aria-pressed")) === "true" &&
      !(await owner.evaluate((el) => el.classList.contains("location")))
    ) {
      await owner.scrollIntoViewIfNeeded();
      if (touch) await owner.tap();
      else await owner.click();
    }
  }
}
// A tap on a message that is still typing finishes the text. Wait for it
// to finish before tapping to play.
export function readyActionButton(page, kind) {
  const action = kind ? `[data-action="${kind}"]` : ".card-primary";
  return page.locator(`#card-actions ${action}:not([data-revealing="true"])`);
}
// A new local world opens on Vale alone, the lit lamp and the attic face down
// (opening.mjs). Its context button offers no play while either is down: the
// lamp's tap turns it, the quiet Reveal turns the attic and chooses the lamp,
// and only then does the rules' first play, Put out, douse it. Any play on
// the revealed cards (a Wait) is a first play too.
export async function revealOpening(page) {
  await revealCard(page, "vale");
  await selectCard(page, "lamp");
  await page
    .locator('#card-actions [data-quiet="true"]:not([data-revealing="true"])')
    .click();
  await readyActionButton(page, "snuff").waitFor();
}
export async function putOutOpening(page) {
  await revealOpening(page);
  await readyActionButton(page, "snuff").click();
}
// The beat stack's cards take real pointer hits: the front card under its own
// centre, and the card behind under its peeking top line (#1538).
export async function stackHits(page) {
  return page.evaluate(() => {
    const hit = (id, dy) => {
      const card = document.getElementById(id);
      if (!card || card.hidden) return null;
      const box = card.getBoundingClientRect();
      const y = dy ? box.top + dy : box.top + box.height / 2;
      return Boolean(
        document
          .elementFromPoint(box.left + box.width / 2, y)
          ?.closest(`#${id}`),
      );
    };
    return { front: hit("speech-row"), behind: hit("beat-behind", 6) };
  });
}

// Words that failed show "…" with no failure UI (#2008's Retry is gone), so a
// smoke that needs its fixture's words checks the table's own marker: the
// save's revision whose words fell silent.
export async function wordsFellSilent(page, key) {
  return page.evaluate((key) => {
    try {
      const marker = localStorage.getItem(`${key}.words-failed`) || "";
      const save = JSON.parse(localStorage.getItem(key) || "null");
      return (
        Boolean(marker) &&
        !marker.endsWith(":pending") &&
        marker === String(save?.revision)
      );
    } catch {
      return false;
    }
  }, key);
}

// Card labels (style.css): every shown card has one name label at its top,
// in at most `lines` lines, broken only between words; a face-down or locked
// box shows none. Pass to page.evaluate; it returns the problems found.
export function labelProblems({
  root = "#hand, #settings-hand",
  lines = 2,
} = {}) {
  const problems = [];
  for (const card of document.querySelectorAll(
    `:is(${root}) .card-frame:not([hidden]) > .card`,
  )) {
    if (!card.checkVisibility()) continue;
    const id = card.dataset.card || card.dataset.setting || "quest",
      labels = [...card.querySelectorAll(":scope > :is(.name, .quest-head)")],
      shown = labels.filter(
        (el) =>
          el.textContent.trim() &&
          el.checkVisibility({ visibilityProperty: true }),
      );
    const box =
      card.dataset.unrevealed === "true" || card.dataset.locked === "true";
    if (box) {
      if (shown.length) problems.push(`${id} box shows a label`);
      continue;
    }
    if (shown.length !== 1) {
      problems.push(`${id} has ${shown.length} labels`);
      continue;
    }
    const label = shown[0],
      text = label.querySelector(".quest-verb") || label,
      style = getComputedStyle(text);
    if (label.offsetParent !== card || label.offsetTop > 1)
      problems.push(`${id} label not at the top`);
    const height =
      text.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom);
    const count = Math.round(height / parseFloat(style.lineHeight));
    if (count > lines)
      problems.push(`${id} "${text.textContent}" in ${count} lines`);
    // A word's letters run left to right on one line; a wrap jumps back.
    const range = document.createRange(),
      walk = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let last = null;
    for (let node = walk.nextNode(); node; node = walk.nextNode())
      for (let i = 0; i < node.length; i++) {
        if (/\s/u.test(node.data[i])) {
          last = null;
          continue;
        }
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const left = range.getBoundingClientRect().left;
        if (last !== null && left < last - 1)
          problems.push(`${id} "${text.textContent}" breaks inside a word`);
        last = left;
      }
  }
  return problems;
}

// A card's name breaks only between words: every word of every shown name
// lies on one line. Returns the words that a line break split (and where).
export async function splitNameWords(page) {
  return page.evaluate(() => {
    const split = [];
    for (const name of document.querySelectorAll(".card .name")) {
      const text = name.firstChild;
      if (text?.nodeType !== Node.TEXT_NODE || !name.getClientRects().length)
        continue;
      for (const word of text.data.matchAll(/[^\s\-–]+/gu)) {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        const lines = new Set(
          [...range.getClientRects()]
            .filter((rect) => rect.width > 0)
            .map((rect) => Math.round(rect.top)),
        );
        if (lines.size > 1) split.push(`${word[0]} in ${text.data}`);
      }
    }
    return split;
  });
}
