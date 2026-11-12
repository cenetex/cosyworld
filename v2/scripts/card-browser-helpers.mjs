import { packDefinitions } from "../card-game/pack-registry.mjs";
import { holdChoice } from "../card-game/world.mjs";
import { roomFuelFromTurns } from "../card-game/lamp-room-fuel.mjs";

// The lamp's fuel counts rooms (#2580), so a fixture that sets turns of oil
// sets both, in place.
export function setLampFuel(world, turns, place) {
  Object.assign(world.items.lamp, roomFuelFromTurns(turns, place), {
    fuel: Math.ceil(turns / 4) * 4,
  });
}

// Light and Snuff are not rules plays since #2580: the lamp burns while the
// avatar holds it, and holding nothing puts it out (the opening's first play,
// which opens the Black pond). Returns the world after that quiet choice.
export function holdItem(world, item = null, actor = "vale") {
  const next = structuredClone(world);
  holdChoice(next, actor, { item, revision: next.revision });
  return next;
}

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
export async function tapCard(card, { touch = false } = {}) {
  await card.scrollIntoViewIfNeeded();
  const { width } = await card.boundingBox();
  const top = { x: width / 2, y: 16 };
  // A neighbour may lie over the top: tap the card's visible part instead.
  const covered = await card.evaluate((el, at) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + at.x, box.top + at.y);
    return !(hit === el || el.contains(hit));
  }, top);
  const options = { position: covered ? await visibleSpot(card) : top };
  if (touch) await card.tap(options);
  else await card.click(options);
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
// The context button's own words. When the whole descriptor is the button
// its text is the tap cue ("Tap to turn music off") and its accessible name
// is the action; a disabled reason keeps its words as text.
export async function actionLabel(button) {
  return (await button.getAttribute("aria-label")) ?? (await button.textContent());
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

// At a local table, Settings holds New game, which asks again (#1892, #2710).
export async function startNewGame(page) {
  await openSettings(page);
  await pressSetting(page, "new-game", 2);
}

// Three or more unturned cards lie in the hand as one face-down stack (the
// pack, pack-opening.mjs), and the cards in it are tucked away. A step that
// wants one of them opens the pack as a player would: tap the stack, tap the
// card (inside a pack the first tap turns it), then tap away. Only that card
// is turned; the rest go back face down, and form a pack again if three or
// more remain. Returns whether the card was in a pack.
export async function openPack(page, id) {
  const card = page.locator(`#hand [data-card="${id}"]`);
  if ((await card.count()) === 0) return false;
  const inPack = async () =>
    (await card.locator("..").getAttribute("data-pack")) !== null;
  if (!(await inPack())) return false;
  const stack = page.locator(
    '#hand > .card-frame[data-pack="closed"]:not([hidden]) > .card',
  );
  if (await stack.count()) {
    await stack.first().click({ position: await visibleSpot(stack.first()) });
    await page.locator('#hand [data-pack="open"]').first().waitFor();
    // The hand rises and the cards rise into the row (460 ms, 350 ms apart).
    await page.waitForTimeout(900);
  }
  // The row is raised and the card is in it: a tap turns it at once.
  // A locked box reads data-unrevealed "false" yet is still face down to the
  // pack (app.mjs draws it as the lock), so its first tap turns it too.
  if (
    (await card.getAttribute("data-unrevealed")) === "true" ||
    (await card.getAttribute("data-locked")) === "true"
  ) {
    await card.scrollIntoViewIfNeeded();
    await card.click({ position: await visibleSpot(card) });
    await page.waitForFunction(
      (id) => {
        const card = document.querySelector(`#hand [data-card="${id}"]`);
        return card?.dataset.unrevealed === "false" && !card.dataset.revealing;
      },
      id,
    );
  }
  // Tapping away puts the pack back into the hand, the pointer left over
  // empty ground where it would not lift a card.
  await page.keyboard.press("Escape");
  await page.mouse.move(2, 2);
  await page.waitForFunction(() => !document.querySelector('#hand [data-pack="open"]'));
  await page.waitForTimeout(700);
  return true;
}

// Use the same holder reveal and selection gestures as a player.
export async function revealCard(page, id, { keepSelected = false } = {}) {
  await openPack(page, id);
  const card = page.locator(`#hand [data-card="${id}"]`);
  const wasSelected = (await card.getAttribute("aria-pressed")) === "true";
  const frame = card.locator("..");
  const holder = await frame.getAttribute("data-holder");
  if ((await frame.getAttribute("hidden")) !== null) {
    if (!holder) await fanWays(page, frame);
    else if (!(await fanAvatarStack(page, holder))) {
      // A pack settled back leaves more cards face up in the fan, so aim at
      // a spot where the holder is topmost.
      const owner = await revealCard(page, holder);
      await owner.click({ position: await visibleSpot(owner) });
      await fanAvatarStack(page, holder);
    }
  } else if (
    holder &&
    (await card.getAttribute("aria-expanded")) === "false" &&
    !(await card.evaluate((el) => el.classList.contains("location")))
  )
    await tapCard(card);
  await card.scrollIntoViewIfNeeded();
  // Select the closed box, then open it through its descriptor.
  if ((await card.getAttribute("data-unrevealed")) === "true") {
    const open = page.locator(`#card-actions [data-open-box="${id}"]`);
    // Escape can keep a held box selected in the folded hand. Open its
    // details first; a selected card alone does not mean its action is shown.
    if (!(await open.count())) await tapCard(card);
    if ((await card.getAttribute("aria-pressed")) !== "true") await tapCard(card);
    await open.click();
    await page.waitForFunction(
      (id) =>
        !document.querySelector(`#hand [data-card="${id}"]`)?.dataset.revealing,
      id,
    );
    if (!keepSelected && !wasSelected && (await card.getAttribute("aria-pressed")) === "true") await tapCard(card);
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
// Open a covered top through its descriptor, then fan the ways.
async function fanWays(page, frame) {
  for (let i = 0; i < 3 && (await wayTop(page).count()); i++) {
    await tapCard(wayTop(page).last());
    if (await page.locator("#card-actions [data-open-box]").count())
      await page.locator("#card-actions [data-open-box]").click();
    await page.waitForFunction(
      () => !document.querySelector("#hand [data-revealing]"),
    );
  }
  return (await frame.getAttribute("hidden")) === null;
}
// The avatar's things lie in a stack beside it, and its one quest card is a
// card of its own; a folded stack's top card fans it out (#2256).
async function fanAvatarStack(page, holder) {
  const folded = page.locator(
    `#hand .card-frame[data-holder="${holder}"]:not([hidden], [data-want]) > .card[aria-expanded="false"]:not(.location)`,
  );
  if (!(await folded.count())) return false;
  const id = await folded.first().getAttribute("data-card");
  const top = page.locator(`#hand [data-card="${id}"]`);
  if ((await top.getAttribute("data-unrevealed")) === "true") {
    await tapCard(top);
    await page.locator("#card-actions [data-open-box]").click();
    await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
    if ((await top.getAttribute("aria-pressed")) === "true") await tapCard(top);
  }
  await tapCard(top);
  const chosen = page.locator(`#hand [data-card="${id}"]`);
  // Fanning also selects the top card. Lower it before choosing another.
  if ((await chosen.getAttribute("aria-pressed")) === "true")
    await tapCard(chosen);
  return true;
}
// Escape folds the hand but keeps its held item. A scripted step naming its
// own cards must also tap that item to stow it before making a fresh choice.
// Every card in the hand is reachable to a person's tap: shown with a spot
// that is its own, or tucked in a stack whose top is shown (a pack's stack, a
// holder's stack, the ways on) and itself reachable. Returns the cards that
// are not, so a stack with no visible top, or a card wholly under its
// neighbours, cannot slip by. A card a person must scroll to counts as
// shown. Pass to assert.deepEqual(await unreachableCards(page), []).
export function unreachableCards(page) {
  return page.evaluate(() => {
    const frames = [...document.querySelectorAll("#hand > .card-frame")];
    const buttonOf = (frame) => frame.querySelector(":scope > .card");
    const tappable = (frame) => {
      const el = buttonOf(frame);
      if (frame.hidden || !el.checkVisibility()) return false;
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      const box = el.getBoundingClientRect();
      for (const fy of [0.3, 0.5, 0.7, 0.15])
        for (let x = box.left + 4; x < box.right - 2; x += 6) {
          const hit = document.elementFromPoint(x, box.top + box.height * fy);
          if (hit === el || el.contains(hit)) return true;
        }
      return false;
    };
    const byId = (id) =>
      frames.find((frame) => buttonOf(frame).dataset.card === id);
    const reach = (frame, depth = 0) => {
      if (depth > 4) return false;
      if (tappable(frame)) return true;
      if (!frame.hidden) return false;
      if (frame.dataset.pack === "closed")
        return frames.some((other) => other.dataset.pack === "closed" && tappable(other));
      const holder = frame.dataset.holder && byId(frame.dataset.holder);
      if (holder) return reach(holder, depth + 1);
      // The ways on: tucked behind a shown card that folds them.
      return frames.some(
        (other) =>
          !other.hidden &&
          buttonOf(other).getAttribute("aria-expanded") === "false" &&
          tappable(other),
      );
    };
    return frames
      .filter((frame) => buttonOf(frame).dataset.card && !reach(frame))
      .map((frame) => buttonOf(frame).dataset.card);
  });
}
export async function clearSelection(page) {
  await page.keyboard.press("Escape");
  const held = page.locator('#hand .card[aria-pressed="true"]');
  if (await held.count()) {
    const card = await revealCard(
      page,
      await held.first().getAttribute("data-card"),
    );
    if ((await card.getAttribute("aria-pressed")) === "true")
      await tapCard(card);
    if ((await card.getAttribute("aria-pressed")) === "true")
      await tapCard(card);
  }
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
// A fanned card lies partly under the next ones (the row grows with every
// offer card), so its centre may be covered. Aim at a point where the card
// itself is topmost, as a player taps its visible part.
async function visibleSpot(card) {
  await card.scrollIntoViewIfNeeded();
  return card.evaluate((el) => {
    const box = el.getBoundingClientRect(),
      mine = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return hit === el || el.contains(hit);
      };
    // A card in the fan shows its left part; later cards lie over its right.
    // Take the leftmost spot that stays the card's own a little to its right
    // too, so the pointer's hover shifting the row does not move it away.
    for (const fy of [0.3, 0.5, 0.7, 0.15]) {
      const y = box.top + box.height * fy;
      for (let x = box.left + 10; x < box.right - 2; x += 6)
        if (mine(x, y) && mine(x + 10, y)) return { x: x - box.left, y: y - box.top };
    }
    for (const fy of [0.3, 0.5, 0.7, 0.15]) {
      const y = box.top + box.height * fy;
      for (let x = box.left + 2; x < box.right - 2; x += 6)
        if (mine(x, y)) return { x: x - box.left, y: y - box.top };
    }
    return { x: box.width / 2, y: box.height / 2 };
  });
}
export async function selectCard(
  page, id, { touch = false, exposedTop = false } = {},
) {
  // A touch tap at the card's exposed top (#2668) or at its visible part.
  const press = async (card) => {
    if (touch && exposedTop) return tapCard(card, { touch: true });
    const position = await visibleSpot(card);
    if (touch) await card.tap({ position });
    else await card.click({ position });
  };
  const frame = page.locator(`#hand [data-card="${id}"]`).locator("..");
  const wasSelected =
    (await frame.locator(".card").getAttribute("aria-pressed")) === "true";
  const holder =
    (await frame.getAttribute("hidden")) !== null
      ? await frame.getAttribute("data-holder")
      : null;
  const card = await revealCard(page, id, { keepSelected: true });
  if (wasSelected || (await card.getAttribute("aria-pressed")) !== "true") {
    await press(card);
  }
  // A rested held card first opens its details; this helper's toggle lowers it.
  if (wasSelected && (await card.getAttribute("aria-pressed")) === "true") {
    await press(card);
  }
  // Keep the chosen child raised while returning its browsing avatar to the stack.
  if (holder) {
    const owner = page.locator(`#hand [data-card="${holder}"]`);
    if (
      (await owner.getAttribute("aria-pressed")) === "true" &&
      !(await owner.evaluate((el) => el.classList.contains("location")))
    ) {
      await press(owner);
    }
  }
}
// A tap on a message that is still typing finishes the text. Wait for it
// to finish before tapping to play.
export function readyActionButton(page, kind) {
  const action = kind ? `[data-action="${kind}"]` : ".card-primary";
  return page.locator(`#card-actions ${action}:not([data-revealing="true"])`);
}
// The opening reveals Vale, the held lamp and the attic without a turn.
// Stowing the lamp then darkens the mirror quietly, with no Light/Snuff play.
export async function revealOpening(page) {
  await revealCard(page, "vale");
  // Vale's own waking line starts with his reveal and holds the bar.
  await settleHand(page);
  await revealCard(page, "lamp", { keepSelected: true });
  const reveal = page.locator(
    '#card-actions [data-quiet="true"]:not([data-revealing="true"])',
  );
  if (
    (await page
      .locator('#hand [data-card="attic"]')
      .getAttribute("data-unrevealed")) === "true"
  )
    await reveal.click();
  await page.waitForFunction(
    () =>
      document.querySelector('#hand [data-card="attic"]')?.dataset
        .unrevealed === "false",
  );
  await page.waitForFunction(
    () => !document.querySelector("#hand [data-revealing]"),
  );
}
export async function putOutOpening(page) {
  await revealOpening(page);
  const lamp = await revealCard(page, "lamp");
  await tapCard(lamp);
  if ((await lamp.getAttribute("aria-pressed")) === "true") await tapCard(lamp);
  await page.waitForFunction(
    () =>
      document.querySelector('#hand [data-card="lamp"]')?.dataset.lit ===
      "false",
  );
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

// Words that fail show a silent "…" beat, and the hand stays busy until a tap
// reads each beat. Read them until the hand is ready.
export async function settleHand(page) {
  const hand = page.locator("#hand");
  const advance = page.locator("#dialogue-advance");
  for (let beats = 0; beats < 20; beats++) {
    await page.waitForFunction(
      () =>
        document.querySelector("#hand").dataset.cooling === "false" ||
        document.querySelector("#dialogue-advance")?.offsetParent,
    );
    if ((await hand.getAttribute("data-cooling")) === "false") return;
    await advance.click();
  }
  throw new Error("The hand stayed busy after twenty beats.");
}
