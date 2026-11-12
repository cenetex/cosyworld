// The pack opening (pack-opening.mjs). Arriving at a place with three or more
// cards not yet turned, they lie in the hand as ONE face-down stack. Tapping
// it raises the hand and the cards rise into the row, still face down, a
// Rare or better showing only a rim glow. The one button is the whole
// descriptor (New cards unlocked, Tap to reveal all); a tap on a card turns
// it at once; Reveal all turns the rest commons first; a tap finishes the
// run; All cards revealed, Tap to continue settles them back into the hand. A
// locked box in the pack is turned and stays locked. Nothing is named before
// it is turned. At 390 and 1440 px, and with reduced motion.
//
// The place is chosen at run time by counting the cards each place deals;
// the unturned set is seeded into the save's seen list.
//
//   node v2/scripts/smoke-card-pack-opening.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { isLockedBox } from "../card-game/locked-box.mjs";
import { levelTier } from "../card-game/level-tiers.mjs";
import { cardLevel } from "../card-game/rarity.mjs";
import {
  createWorld,
  encodeSave,
  nameOf,
  people,
  places,
  things,
} from "../card-game/world.mjs";
import { smokeWidths, tapCard, unreachableCards } from "./card-browser-helpers.mjs";

const shots = process.argv[2]
  ? new URL(`file://${process.argv[2].replace(/\/?$/u, "/")}`)
  : null;
if (shots) await mkdir(shots, { recursive: true });

// The place that deals the most cards, with a locked box and a Rare or better
// among them when one does. Counted now, from the rules, not named.
function chooseScenario() {
  let best = null;
  for (const place of Object.keys(places)) {
    let world;
    try {
      world = createWorld({ opening: false, seed: 7 });
      world.actors.vale.place = place;
    } catch {
      continue;
    }
    let here;
    try {
      here = availableCards(world).filter(
        (id) => id !== "vale" && !id.startsWith("quest:"),
      );
    } catch {
      continue;
    }
    const boxes = here.filter((id) => isLockedBox(world, id)).length,
      rare = here.filter(
        (id) => !id.startsWith("quest:") && levelTier(cardLevel(world, id)).rank >= 2,
      ).length;
    const score = here.length + (boxes ? 3 : 0) + (rare ? 3 : 0);
    if (!best || score > best.score) best = { place, score, here, world, boxes, rare };
  }
  assert.ok(best && best.here.length >= 4, "a place deals four or more cards");
  return best;
}
const scenario = chooseScenario();
console.log(
  `scenario: ${scenario.place}, ${scenario.here.length} cards, ${scenario.boxes} locked, ${scenario.rare} rare or better`,
);

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});

async function openTable(width, motion, { covered, tag }) {
  const key = `cosyworld.reflected-shore.v1.${tag}`;
  const everything = [
    ...Object.keys(people),
    ...Object.keys(things),
    ...Object.keys(places),
  ];
  const world = createWorld({ opening: false, seed: 7 });
  world.actors.vale.place = scenario.place;
  const page = await browser.newPage({
    viewport: { width, height: width < 600 ? 844 : 900 },
    reducedMotion: motion,
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, save, seen, covered }) => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem(`${key}.seen.covered`, JSON.stringify(covered));
      }
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
    },
    {
      key,
      save: encodeSave(world),
      seen: everything.filter((id) => !covered.includes(id)),
      covered,
    },
  );
  await page.route("**/card-game/text", (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: input.revision,
        model: "pack-fixture",
        entries: input.entities.map(({ id }) => ({ id, text: "There is time to look around." })),
      }),
    });
  });
  await page.goto(`${origin}/?table=${tag}`);
  await page.waitForFunction(() => document.querySelector("#hand")?.dataset.cooling === "false");
  return { page, key, errors };
}

// The pack's one button is the whole descriptor: its sentence, and the tap
// cue in its corner.
const buttons = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#card-actions button")]
      .filter((b) => b.checkVisibility())
      .map((b) => `${b.textContent.trim()} / ${b.dataset.tapHint}`),
  );
const ASKS = {
  "Reveal all": "New cards unlocked / Tap to reveal all",
  "Tap to finish": "Turning the cards / Tap to finish",
  Done: "All cards revealed / Tap to continue",
};
const oneButton = async (page, ask, step) => {
  const text = ASKS[ask];
  await page.waitForFunction(
    (text) => {
      const shown = [...document.querySelectorAll("#card-actions button")].filter((b) =>
        b.checkVisibility(),
      );
      return (
        shown.length === 1 &&
        document.querySelector("#action-beat").getAttribute("data-card-tap") === "" &&
        shown[0].dataset.revealing === "false" &&
        `${shown[0].textContent.trim()} / ${shown[0].dataset.tapHint}` === text
      );
    },
    text,
  );
  assert.deepEqual(await buttons(page), [text], step);
  // The button fills its descriptor: no strip is left under it.
  const fill = await page.evaluate(() => {
    const panel = document.querySelector("#action-beat").getBoundingClientRect(),
      button = document.querySelector("#card-actions button").getBoundingClientRect();
    return panel.height - button.height;
  });
  assert.ok(fill <= 4, `${step}: the button fills the descriptor (${fill}px left)`);
};
const unturned = (page, key) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(`${key}.seen.covered`) || "[]"),
    key,
  );
const handIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#hand .card[data-card]")].map((c) => c.dataset.card),
  );

for (const [width, motion] of [
  [390, "no-preference"],
  [1440, "no-preference"],
  [390, "reduce"],
]) {
  const label = `${width}px ${motion}`;
  const tag = `pack-${width}-${motion}`;
  const members = scenario.here;
  const names = members.map((id) => nameOf(id)).filter(Boolean);
  const { page, key, errors } = await openTable(width, motion, { covered: members, tag });
  const shot = async (name) => {
    if (shots) await page.screenshot({ path: new URL(`${tag}-${name}.png`, shots).pathname });
  };

  // 1. One face-down stack, thickness hinting at the count, nothing named.
  await page.waitForFunction(() => document.querySelectorAll('#hand [data-pack="closed"]').length > 1);
  const visibleStacks = await page.evaluate(
    () => [...document.querySelectorAll('#hand [data-pack="closed"]')].filter((f) => !f.hidden).length,
  );
  assert.equal(visibleStacks, 1, `${label}: the pack is one stack`);
  const edges = await page.locator('#hand [data-pack="closed"]:not([hidden]) > .place-edge').count();
  assert.ok(edges >= 1 && edges <= 3, `${label}: the stack's thickness shows ${edges} edges`);
  const hiddenInStack = await page.locator('#hand [data-pack="closed"][hidden]').count();
  assert.equal(hiddenInStack + 1, await page.locator('#hand [data-pack="closed"]').count());
  assert.deepEqual(await buttons(page), [], `${label}: a closed stack asks for nothing`);
  const closedFacts = await page.evaluate(() => ({
    labels: [...document.querySelectorAll("#hand .card")].map((c) => c.getAttribute("aria-label") || ""),
    levels: [...document.querySelectorAll('#hand [data-pack] .card, #hand [data-pack] > .card')].map((c) => c.dataset.level),
    tells: document.querySelectorAll("#hand [data-tell]").length,
    text: document.body.innerText,
  }));
  for (const name of names)
    for (const text of [...closedFacts.labels, closedFacts.text])
      assert.ok(
        !text.toLowerCase().includes(name.toLowerCase()) || name.length < 4,
        `${label}: "${name}" is named before its card is turned`,
      );
  assert.equal(closedFacts.tells, 0, `${label}: a closed stack shows no tell`);
  assert.deepEqual(await unreachableCards(page), [], `${label}: a closed pack's cards are reachable`);
  await shot("1-closed");

  // 2. Tap the pack: the hand rises, the cards rise face down, one button.
  await tapCard(page.locator('#hand [data-pack="closed"]:not([hidden]) > .card'));
  await page.waitForFunction(() => document.querySelectorAll('#hand [data-pack="open"]').length > 1);
  await oneButton(page, "Reveal all", `${label}: an open pack asks one thing`);
  assert.equal(await page.locator("body").getAttribute("data-hand-expanded"), "true");
  const shownOpen = await page.evaluate(
    () => [...document.querySelectorAll('#hand [data-pack="open"]')].filter((f) => !f.hidden).length,
  );
  // The pack also holds the place's offered quests, closed boxes too.
  assert.ok(shownOpen >= members.length, `${label}: every card of the pack is in the row`);
  const open = await page.evaluate(() =>
    [...document.querySelectorAll('#hand [data-pack="open"] > .card')].map((c) => ({
      id: c.dataset.card,
      level: c.dataset.level,
      tier: c.dataset.tier,
      tell: c.dataset.tell || "",
      unrevealed: c.dataset.unrevealed,
      locked: c.dataset.locked,
      glow: c.getAnimations().filter((a) => a.id === "pack-tell").length,
      breathes: c
        .getAnimations()
        .some((a) => a.id === "pack-tell" && a.effect.getKeyframes().some((k) => "opacity" in k)),
      name: c.querySelector(".name")?.textContent.trim() ?? "",
    })),
  );
  assert.equal(open.length, shownOpen);
  for (const card of open) {
    assert.equal(card.level, "1", `${label}: ${card.id} still reads level 1 face down`);
    assert.equal(card.tier, "common", `${label}: ${card.id} still reads common face down`);
    assert.equal(card.name, "", `${label}: ${card.id} has no name face down`);
  }
  const tells = open.filter((card) => card.tell);
  assert.ok(tells.length >= scenario.rare, `${label}: the Rare or better show a tell`);
  assert.ok(tells.length < open.length, `${label}: not every card shows a tell`);
  for (const card of tells) {
    assert.ok(card.glow >= 1, `${label}: ${card.id} glows`);
    assert.equal(card.breathes, motion !== "reduce", `${label}: the glow pulses only with motion`);
  }
  await page.waitForTimeout(700);
  assert.deepEqual(await unreachableCards(page), [], `${label}: an open pack's cards are reachable`);
  await shot("2-open-face-down");

  // 3. A tap inside a pack turns the card at once and chooses nothing.
  const first = open.find((card) => card.locked !== "true" && !card.id.startsWith("quest:"));
  const firstCard = page.locator(`#hand [data-card="${first.id}"]`);
  await firstCard.scrollIntoViewIfNeeded();
  await tapCard(firstCard);
  await page.waitForFunction(
    (id) => document.querySelector(`#hand [data-card="${id}"]`)?.dataset.unrevealed === "false",
    first.id,
  );
  assert.equal(await firstCard.getAttribute("aria-pressed"), "false", `${label}: the turn chose nothing`);
  assert.ok(!(await unturned(page, key)).includes(first.id), `${label}: the turned card is remembered`);
  await oneButton(page, "Reveal all", `${label}: still one button after a turn`);
  // Outside a pack the first tap still only selects: a turned card is chosen.
  await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
  await shot("3-one-turned");

  // 4. Reveal all: one button, "Tap to finish"; mid-run frames.
  await page.locator("#card-actions [data-pack='reveal']").click();
  await oneButton(page, "Tap to finish", `${label}: a run asks to be finished`);
  await page.waitForTimeout(motion === "reduce" ? 500 : 900);
  await shot("4-mid-run");

  // 5. A tap finishes it: every card turned, none half turned, one Done.
  await page.waitForTimeout(350);
  const finish = page.locator("#card-actions [data-pack='finish']");
  // With motion the run is still playing a second in: this tap is the skip.
  // The unturned cards at that moment all turn at once.
  const stillDown = (await unturned(page, key)).filter((id) => members.includes(id));
  if (motion !== "reduce") {
    assert.equal(await finish.count(), 1, `${label}: the run is still playing`);
    assert.ok(stillDown.length >= 1, `${label}: some cards are still face down to skip`);
  }
  if (await finish.count()) await finish.click();
  await oneButton(page, "Done", `${label}: every card turned asks for Done`);
  await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
  assert.deepEqual(
    (await unturned(page, key)).filter((id) => members.includes(id)),
    [],
    `${label}: nothing is left face down`,
  );
  const turned = await page.evaluate(() =>
    [...document.querySelectorAll('#hand [data-pack="open"] > .card')].map((c) => ({
      id: c.dataset.card,
      unrevealed: c.dataset.unrevealed,
      locked: c.dataset.locked,
      level: c.dataset.level,
      revealing: c.dataset.revealing || "",
      tell: c.dataset.tell || "",
      glow: c.getAnimations().filter((a) => a.id === "pack-tell").length,
    })),
  );
  for (const card of turned) {
    assert.equal(card.unrevealed, "false", `${label}: ${card.id} is turned`);
    assert.equal(card.revealing, "", `${label}: ${card.id} is not half turned`);
    assert.equal(card.tell, "", `${label}: ${card.id} keeps no tell once turned`);
    assert.equal(card.glow, 0, `${label}: ${card.id} keeps no glow once turned`);
  }
  // A locked box in the pack is turned and still locked.
  for (const id of members.filter((id) => isLockedBox(scenario.world, id))) {
    const box = turned.find((card) => card.id === id);
    assert.ok(box, `${label}: the locked box ${id} was in the pack`);
    assert.equal(box.locked, "true", `${label}: ${id} is still locked`);
    assert.ok(!(await unturned(page, key)).includes(id), `${label}: ${id} was turned`);
  }
  assert.match(
    await page.locator("#discovery-announcement").textContent(),
    /^\d+ cards turned\. Rarest: (Common|Uncommon|Rare|Epic|Legendary|Mythic)\.$/u,
    `${label}: one batched announcement`,
  );
  // The turned cards are named now.
  const shownNames = await page.evaluate(
    () => [...document.querySelectorAll('#hand [data-pack="open"] .name')].map((n) => n.textContent.trim()).filter(Boolean),
  );
  assert.ok(shownNames.length >= 1, `${label}: turned cards show their names`);
  await shot("5-all-turned-done");

  // 6. Done settles the cards back into the hand.
  const before = await handIds(page);
  // A press right after the last turn is taken for the double tap of
  // "Tap to finish" and ignored (a quarter second).
  await page.waitForTimeout(300);
  await page.locator("#card-actions [data-pack='done']").click();
  await page.waitForFunction(() => !document.querySelector("#hand [data-pack]"));
  await page.waitForTimeout(700);
  assert.equal(await page.locator("body").getAttribute("data-hand-expanded"), "false");
  assert.deepEqual([...(await handIds(page))].sort(), [...before].sort(), `${label}: every card is in the hand`);
  assert.equal(await page.locator("#hand [data-unrevealed='true']").count(), 0);
  assert.equal(await page.locator("#hand [data-pack]").count(), 0);
  assert.deepEqual(await unreachableCards(page), [], `${label}: settled cards are reachable`);
  await shot("6-settled");
  assert.deepEqual(errors, [], `${label}: no page errors`);
  await page.close();
}

// Fewer than three unturned cards are no pack: they turn in place as before.
{
  const pair = scenario.here.filter((id) => !id.startsWith("quest:")).slice(0, 2);
  const { page, key, errors } = await openTable(390, "no-preference", {
    covered: pair,
    tag: "pack-pair",
  });
  await page.waitForTimeout(800);
  assert.equal(await page.locator("#hand [data-pack]").count(), 0, "two cards form no pack");
  assert.ok((await unturned(page, key)).length >= 1);
  assert.deepEqual(errors, []);
  await page.close();
}

await browser.close();
server.close();
console.log("pack opening ok");
