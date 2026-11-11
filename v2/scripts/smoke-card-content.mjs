import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { clearSelection, revealOpening, tapCard } from "./card-browser-helpers.mjs";

// A player holding no quest shows no quest card at all: no fold behind the
// avatar, no quest card, no Discard. A met quest leaves none, and nothing is
// drawn to replace it: waking from a Sleep deals no quest either.
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true });
const output = resolve(
  process.env.COSYWORLD_CONTENT_SHOTS || "output/card-content",
);
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    });
    await page.route("**/card-game/text", (route) =>
      route.fulfill({ status: 503, json: { error: "fixture" } }),
    );
    const table = `content-${width}`,
      key = `cosyworld.reflected-shore.v1.${table}`;
    const ready = () =>
      page.waitForFunction(
        () => document.querySelector("#hand").dataset.cooling === "false",
      );
    const vale = () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).actors.vale,
        key,
      );
    const play = (label) =>
      page.locator("#card-actions button", { hasText: label }).first().click();
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await ready();
    await revealOpening(page);
    // Vale's only quest is the lamp it holds; the residents stay content so
    // the plays are Vale's own.
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      const vale = s.actors.vale;
      vale.visited = [...new Set([...vale.visited, "pond"])];
      vale.want = { kind: "item", target: "lamp", since: s.turn, refusals: 0 };
      for (const id of ["moth", "keeper"]) s.actors[id].want = null;
      localStorage.setItem(key, JSON.stringify(s));
    }, key);
    await page.reload();
    await ready();
    assert.equal(await page.locator("#hand .quest-fold").count(), 1);
    // Any play meets it; the card goes and its experience is paid at once.
    const xp = (await vale()).xp;
    await clearSelection(page);
    await tapCard(page.locator('#hand [data-card="vale"]'));
    await play("Wait");
    await ready();
    await page.waitForFunction(
      (key) => JSON.parse(localStorage.getItem(key)).actors.vale.want === null,
      key,
    );
    // No want and no quest card anywhere in the hand.
    const content = await vale();
    assert.equal(content.want, null);
    assert.ok(content.xp > xp, "the meeting play paid experience");
    assert.equal(await page.locator("#hand .quest-fold").count(), 0);
    assert.equal(await page.locator("#hand .want-frame").count(), 0);
    assert.equal(await page.locator("#hand .want-card").count(), 0);
    // Choosing Vale offers no Discard, and the keyboard walks the hand.
    await tapCard(page.locator('#hand [data-card="vale"]'));
    assert.equal(
      await page.locator("#card-actions [data-drop-quest]").count(),
      0,
    );
    await page.screenshot({ path: resolve(output, `content-${width}.png`) });
    await page.keyboard.press("Escape");
    const stops = new Set();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        return el?.closest("#hand") ? el.dataset.card || el.className : null;
      });
      if (stop) stops.add(stop);
    }
    assert.ok(stops.size > 0, "Tab reaches the hand");
    for (const stop of stops) assert.doesNotMatch(stop, /quest|want/);
    // After a Wait, Vale again offers Sleep; waking draws no quest, so the
    // hand still shows none.
    await page.keyboard.press("Escape");
    await clearSelection(page);
    await tapCard(page.locator('#hand [data-card="vale"]'));
    await play("Sleep");
    await ready();
    await page.waitForFunction(
      (key) => !JSON.parse(localStorage.getItem(key)).actors.vale.sleeping,
      key,
    );
    assert.equal((await vale()).want, null);
    assert.equal(await page.locator("#hand .quest-fold").count(), 0);
    assert.equal(await page.locator("#hand .want-frame").count(), 0);
    await page.screenshot({ path: resolve(output, `woke-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(
      `No quest held shows no quest card, before or after a Sleep, at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
