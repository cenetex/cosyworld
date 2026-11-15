import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import * as W from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { readyActionButton, selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const SHORT =
  "I keep my eyes on the horizon and my hands on the light, Dione. People forget that the shadow isn't just an absence of light; it's a weight. It settles in the corners where no one thinks to look.";
const LONG =
  "It settles in the dough, too. You knead it in without even knowing, a heaviness that makes the crust thick and the center dense. But a hearth cannot survive on shadow alone, no matter how much it tries to crowd the room. Bring me the water from the well and the wheat from the field, and we will see what the oven makes of them. The night is long. The bread is patient. So am I, for now.";
const SIZES = [[2000, 1084], [1440, 900], [1024, 768], [390, 844], [320, 568]];
const typing = (on) =>
  document.querySelector("#dialogue-advance").dataset.revealing === String(on);
const RUN_ON = `And the water ran on ${"and on and on ".repeat(26)}until dawn.`;

const layout = (page) =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const box = (el) => el.getBoundingClientRect().toJSON();
    const shown = (el) => !el.hidden && el.getClientRects().length > 0;
    const text = q("#dialogue-text");
    const range = document.createRange();
    range.selectNodeContents(text);
    const lines = [...range.getClientRects()].filter(
      (r) => r.width > 1 && r.top < box(text).bottom - 1,
    );
    return {
      front: box(q("#speech-row")),
      speaker: box(q("#speaker")),
      text: box(text),
      first: lines[0]?.top,
      last: lines.at(-1)?.bottom,
      hint: shown(q("#speech-hint")) ? box(q("#speech-hint")) : null,
      slot: q(".beat-stack").dataset.action === "true",
      covers: [
        ...[...document.querySelectorAll("#hand .card .name")].filter(
          (n) => shown(n) && getComputedStyle(n).opacity !== "0",
        ),
        ...document.querySelectorAll("#card-actions button"),
      ]
        .filter(shown)
        .map(box),
      page: text.dataset.page,
      words: text.textContent,
      height: innerHeight,
    };
  });

function check(label, l) {
  assert(l.speaker.bottom <= l.first + 1, `${label}: name over the words`);
  if (l.hint)
    assert(l.hint.top >= Math.min(l.last, l.text.bottom) - 1, `${label}: hint`);
  assert(l.front.top >= 0 && l.front.bottom <= l.height + 1, `${label}: shown`);
  for (const r of l.slot ? [] : l.covers)
    assert(
      r.right <= l.front.left ||
        r.left >= l.front.right ||
        r.bottom <= l.front.top + 1 ||
        r.top >= l.front.bottom - 1,
      `${label}: the box covers ${JSON.stringify([r, l.front])}`,
    );
}

async function run([width, height], text, name, fold) {
  const touch = width < 500;
  const world = W.createWorld();
  world.actors.vale.place = world.actors.moth.place = "pond";
  world.actors.moth.want = null;
  const key = "cosyworld.reflected-shore.v1.present";
  const viewport = { width, height };
  const page = await browser.newPage({ viewport, isMobile: touch, hasTouch: touch });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ([key, save, seen]) => {
      localStorage.setItem(key, save);
      localStorage.setItem(`${key}.seen`, seen);
      localStorage.setItem("cosyworld.dialogue.sound", "off");
    },
    [key, W.encodeSave(world), JSON.stringify(availableCards(world))],
  );
  await page.route("**/card-game/text", (route) => {
    const { revision, entities } = route.request().postDataJSON();
    const entries = entities.map(({ id }) => ({ id, text }));
    route.fulfill({ json: { revision, model: "smoke", entries } });
  });
  await page.goto(`${origin}/?table=present`);
  await page.waitForFunction(() => document.querySelector("#hand").dataset.cooling === "false");
  await selectCard(page, "moth", { touch, exposedTop: touch });
  await readyActionButton(page, "talk").click();
  await page.waitForFunction(typing, true);
  if (fold) {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.body.dataset.handExpanded === "false");
    await page.waitForTimeout(700);
  }
  const label = `${name}-${fold ? "resting" : "raised"}-${width}x${height}`;
  const pages = [];
  for (let i = 0; i < 12; i++) {
    await page.locator("#speaker-portrait").click();
    await page.waitForFunction(typing, false);
    await page.waitForTimeout(350);
    const l = await layout(page);
    if (pages.at(-1) !== l.words) {
      pages.push(l.words);
      await page.screenshot({
        path: `${process.env.SHOTS || "output"}/long-${label}-${pages.length}.png`,
      });
      check(`${label} page ${pages.length}`, l);
    }
    if (!l.page || /^(\d+)\/\1$/.test(l.page)) break;
  }
  assert.equal(pages.join(" ").replace(/\s+/g, " "), text, label);
  if (text === LONG && touch && fold) assert(pages.length > 1, label);
  if (text === SHORT) assert.equal(pages.length, 1, label);
  assert.deepEqual(errors, [], label);
  await page.close();
}

try {
  for (const size of SIZES) {
    await run(size, SHORT, "short", true);
    await run(size, LONG, "long", false);
    await run(size, LONG, "long", true);
    await run(size, RUN_ON, "runon", false);
  }
} finally {
  await browser.close();
  server.close();
}
