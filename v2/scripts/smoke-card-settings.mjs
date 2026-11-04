// Settings is a hand of cards: a chosen card puts its action in the context
// button and a press does it, a destructive one only on a second press, and
// the play hand returns on close (settings-cards.mjs). Signed out, then
// signed in; desktop and phone widths, without a sideways scroll.
// SETTINGS_SHOTS=<dir> saves screenshots.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { splitNameWords, tapCard } from "./card-browser-helpers.mjs";

const shots = process.env.SETTINGS_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const label = (page, id) =>
  page.locator(`[data-setting="${id}"]`).getAttribute("aria-label");
try {
  for (const [width, height, signedIn] of [
    [1440, 900, false],
    [390, 844, true],
    [320, 568, false],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/card-game/credits", (route) =>
      route.fulfill({ json: { signed_in: signedIn, balance: 3 } }),
    );
    await page.goto(`${origin}/?table=settings-${width}`);
    await page.locator("#hand .card").first().waitFor();
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#menu-button").click();
    const first = page.locator("#settings-hand .card").first();
    await first.waitFor();
    assert.equal(await first.getAttribute("data-setting"), "privacy");
    assert.equal(await page.locator("#hand").isVisible(), false);
    assert.equal(
      await page.locator("#setting-close").textContent(),
      "Close settings",
    );
    assert.equal(await label(page, "music"), "Music, on");
    // A card lifted over the next narrows that card's name, which still
    // breaks only between words ("Mus / ic" did).
    await tapCard(page.locator('[data-setting="privacy"]'));
    assert.deepEqual(await splitNameWords(page), [], `${width}px names`);
    // Choose, read the button, press it: the card's face and name follow.
    await tapCard(page.locator('[data-setting="music"]'));
    assert.deepEqual(await splitNameWords(page), [], `${width}px names`);
    const press = page.locator("#setting-music");
    assert.equal(await press.textContent(), "Turn music off");
    if (shots) await page.screenshot({ path: `${shots}/music-${width}.png` });
    await press.click();
    assert.equal(await label(page, "music"), "Music, off");
    assert.equal(
      await page.locator('[data-setting="music"]').getAttribute("data-lit"),
      "false",
    );
    assert.equal(await press.textContent(), "Turn music on");
    // A pack switches off and dims, and on again.
    await tapCard(page.locator('[data-setting="pack-sea"]'));
    const sea = page.locator("#setting-pack-sea");
    assert.equal(await sea.textContent(), "Turn The Wine-Dark Sea off");
    await sea.click();
    const dim = page.locator('[data-setting="pack-sea"][data-lit="false"]');
    await dim.waitFor();
    assert.equal(await sea.textContent(), "Turn The Wine-Dark Sea on");
    // Hoppy Cat, reached only by the Sea, dims with it and says why.
    const hoppy = '[data-setting="pack-hoppy"]';
    assert.equal(await page.locator(hoppy).getAttribute("data-lit"), "false");
    await tapCard(page.locator(hoppy));
    assert.equal(
      await page.locator("#setting-pack-hoppy").textContent(),
      "Reached by The Wine-Dark Sea",
    );
    await tapCard(page.locator('[data-setting="pack-sea"]'));
    await sea.click();
    await page.locator('[data-setting="pack-sea"][data-lit="true"]').waitFor();
    // A pack is a place card: the quest card's place painting and its name
    // where the quest sets its verb.
    const pack = page.locator('[data-setting="pack-sea"]');
    assert.equal(await pack.locator(".quest-screen .quest-ground").count(), 1);
    assert.equal(await pack.locator(".quest-figure").count(), 0);
    assert.equal(
      await pack.locator(".quest-head .quest-verb").textContent(),
      "The Wine-Dark Sea",
    );
    // Sign out, signed in, or New game, signed out, waits for a second press.
    const [risky, confirm] = signedIn
      ? ["account", "Tap again to sign out"]
      : ["new-game", "Tap again to replace this world"];
    await tapCard(page.locator(`[data-setting="${risky}"]`));
    await page.locator(`#setting-${risky}`).click();
    assert.equal(
      await page.locator(`#setting-${risky}`).textContent(),
      confirm,
    );
    if (shots)
      await page.screenshot({ path: `${shots}/${risky}-${width}.png` });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `no sideways scroll at ${width}px`,
    );
    // Escape unchooses, then closes; the play hand is back.
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#setting-close").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.locator("#hand .card").first().waitFor();
    assert.equal(await page.locator("#settings-hand").isVisible(), false);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Settings cards: choose, press, confirm, and close at 3 widths.");
} finally {
  await browser.close();
  server.close();
}
