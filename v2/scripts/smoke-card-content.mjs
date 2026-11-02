import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

// Content (rules 90): a met quest with nothing beneath leaves the avatar
// content until its next Sleep, and while content the hand shows no quest
// card at all: no fold behind the avatar, no quest card, no Drop quest.
// Waking from the Sleep draws a new quest and its card comes back.
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
    for (const id of ["vale", "lamp", "attic"])
      await page
        .locator(`#hand [data-card="${id}"]`)
        .evaluate((el) => el.click());
    // Vale's only quest is the lamp it holds; the residents stay content so
    // the plays are Vale's own.
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      const vale = s.actors.vale;
      vale.visited = [...new Set([...vale.visited, "pond"])];
      vale.want = { kind: "item", target: "lamp", since: s.turn, refusals: 0 };
      delete vale.under;
      for (const id of ["moth", "keeper"]) s.actors[id].want = null;
      localStorage.setItem(key, JSON.stringify(s));
    }, key);
    await page.reload();
    await ready();
    assert.equal(await page.locator("#hand .quest-fold").count(), 1);
    // Any play meets it; the sealed card clears with its experience.
    await page.locator('#hand [data-card="vale"]').click();
    await play("Wait");
    await ready();
    const fold = page.locator('#hand .quest-fold[data-glow="invite"]');
    await fold.waitFor();
    await fold.focus();
    await page.keyboard.press("Enter");
    const met = page.locator('#hand .want-card[data-met="true"]');
    await met.waitFor();
    await met.click();
    await page.locator(".quest-xp").waitFor({ state: "detached" });
    await ready();
    // Content: no want, and no quest card anywhere in the hand.
    const content = await vale();
    assert.equal(content.want, null);
    assert.equal(content.content, true);
    assert.equal(await page.locator("#hand .quest-fold").count(), 0);
    assert.equal(await page.locator("#hand .want-frame").count(), 0);
    assert.equal(await page.locator("#hand .want-card").count(), 0);
    // Choosing Vale offers no Drop quest, and the keyboard walks the hand.
    await page.locator('#hand [data-card="vale"]').click();
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
    // After a Wait, Vale again offers Sleep; waking draws a new quest and
    // its card is back behind Vale.
    await page.keyboard.press("Escape");
    await page.locator('#hand [data-card="vale"]').click();
    await play("Sleep");
    await ready();
    await page.waitForFunction((key) => {
      const v = JSON.parse(localStorage.getItem(key)).actors.vale;
      return Boolean(v.want) && !v.content && !v.sleeping;
    }, key);
    await page.locator("#hand .quest-fold").waitFor({ state: "attached" });
    assert.equal(await page.locator("#hand .quest-fold").count(), 1);
    await page.screenshot({ path: resolve(output, `woke-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(
      `Content shows no quest card; Sleep brings one back at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
