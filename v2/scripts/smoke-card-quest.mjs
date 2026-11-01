import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

// The quest folds behind the player's avatar. A met quest stays, sealed,
// until its player clears it; clearing shows the experience it brought.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/quest/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const [width, height, motion] of [
    [390, 844, "no-preference"],
    [1440, 900, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
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
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: "{}",
      }),
    );
    const table = `quest-${width}`,
      key = `cosyworld.reflected-shore.v1.${table}`;
    const ready = () =>
      page.waitForFunction(
        () => document.querySelector("#hand").dataset.cooling === "false",
      );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await ready();
    // Uncover the opening cards, then give Vale the quest of holding the lamp
    // it already holds, past the pond where quests begin.
    for (const id of ["vale", "lamp", "attic"])
      await page
        .locator(`#hand [data-card="${id}"]`)
        .evaluate((el) => el.click());
    await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key));
      const vale = s.actors.vale;
      vale.visited = [...new Set([...vale.visited, "pond"])];
      vale.want = { kind: "item", target: "lamp", since: s.turn, refusals: 0 };
      localStorage.setItem(key, JSON.stringify(s));
    }, key);
    await page.reload();
    await ready();
    const quest = page.locator("#hand .want-frame");
    assert.equal(await quest.isHidden(), true, "the quest folds behind Vale");
    // Vale already holds the lamp, so the folded quest wears the near halo.
    // It is a face-down card in Vale's stack, Vale's size, with no tab.
    const fold = page.locator('#hand .quest-fold[data-glow="near"]');
    assert.equal(await fold.count(), 1);
    assert.equal(await page.locator("#hand .quest-tab").count(), 0);
    const [foldBox, valeBox] = await page.evaluate(() =>
      [".quest-fold", '[data-card="vale"]'].map((s) => {
        const el = document.querySelector(`#hand ${s}`);
        return [el.offsetWidth, el.offsetHeight];
      }),
    );
    assert.deepEqual(foldBox, valeBox, "the folded quest is card sized");
    assert.match(
      await fold.evaluate((el) => getComputedStyle(el).backgroundImage),
      /card-back/,
    );
    await page.screenshot({
      path: new URL(`folded-${width}.png`, output).pathname,
    });
    // Opening Vale's stack brings the quest forward with its halo; the fold
    // behind Vale hides, so Vale's card carries no quest glow.
    await page.locator('#hand [data-card="vale"]').click();
    await quest.waitFor();
    assert.equal(await page.locator("#hand .quest-fold").isHidden(), true);
    assert.equal(
      await page.locator('#hand .want-card[data-near="true"]').isVisible(),
      true,
    );
    await page.screenshot({
      path: new URL(`expanded-${width}.png`, output).pathname,
    });
    // Any play meets it; it stays sealed and the fold glows.
    await page
      .locator("#card-actions button", { hasText: "Wait" })
      .first()
      .click();
    await ready();
    const tab = page.locator('#hand .quest-fold[data-glow="invite"]');
    await tab.waitFor();
    // The fold peeks out behind Vale's card; it also takes the keyboard.
    await tab.focus();
    await page.keyboard.press("Enter");
    const card = page.locator('#hand .want-card[data-met="true"]');
    await card.waitFor();
    assert.equal(await card.locator(".quest-seal").count(), 1);
    assert.equal(await page.locator("#hand .quest-fold").isHidden(), true);
    await page.screenshot({
      path: new URL(`met-${width}.png`, output).pathname,
    });
    await card.click();
    const gain = page.locator(".quest-xp");
    await gain.waitFor();
    assert.match(await gain.textContent(), /^\+\d+ XP$/);
    await page.screenshot({
      path: new URL(`cleared-${width}.png`, output).pathname,
    });
    assert.equal(
      await page.locator('#hand .want-card[data-met="true"]').count(),
      0,
    );
    await gain.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    console.log(
      `Quest fold, met seal, click to clear and +XP passed at ${width}px (${motion}).`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
