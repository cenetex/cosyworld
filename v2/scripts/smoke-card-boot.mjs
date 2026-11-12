// The table boots without an error on every early path: a cold start, a
// local save that fails validation (its New game button, #2043, #2710),
// and storage an in-app browser refuses (its unsaved notice). A notice can
// run before the rest of app.mjs, so a binding it reads before declaration
// throws and leaves an empty table (#2046, #2055). The fast check runs this
// on every pull request.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { actionLabel } from "./card-browser-helpers.mjs";

const INVALID = JSON.stringify({ schema: 8, turn: "x" });
// A save of the retired schema 7 is dropped: a fresh table, no recovery notice.
const RETIRED = JSON.stringify({ schema: 7, turn: 4 });
const cases = {
  // A cold boot deals the opening hand and logs no console error.
  fresh: { notice: null },
  invalid: { save: INVALID, notice: null, freshStart: true },
  retired: { save: RETIRED, notice: null, replaced: true },
  // In-app browsers with DOM storage off refuse every access.
  blocked: { blockStorage: true, notice: /could not save the world/u },
};

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const results = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ])
    for (const [name, spec] of Object.entries(cases)) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.setDefaultTimeout(15000);
      const table = `boot-${name}-${width}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      const report = { name, width, errors: [], console: [] };
      results.push(report);
      page.on("pageerror", (error) => report.errors.push(error.message));
      page.on("console", (message) => {
        // The static server has no /meta, account, or credits routes.
        if (
          message.type() === "error" &&
          !message.text().startsWith("Failed to load resource")
        )
          report.console.push(message.text());
      });
      await page.addInitScript(
        ({ key, save, blockStorage }) => {
          if (blockStorage) {
            Object.defineProperty(window, "localStorage", {
              configurable: true,
              get() {
                throw new DOMException(
                  "The operation is insecure.",
                  "SecurityError",
                );
              },
            });
            return;
          }
          if (save) localStorage.setItem(key, save);
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
        },
        { key, save: spec.save, blockStorage: spec.blockStorage },
      );
      // No model is needed to boot; a request for words answers empty.
      await page.route("**/card-game/text", (route) =>
        route.fulfill({ status: 503, body: "" }),
      );
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=${table}`,
      );
      const status = page.locator("#play-status");
      if (spec.freshStart) {
        const button = page.locator("#card-actions #setting-new-game");
        const beat = page.locator("#action-beat");
        await button.waitFor({ state: "visible" });
        assert.equal(await beat.getAttribute("data-card-tap"), "hint");
        assert.equal(await page.locator("#card-actions button").count(), 1);
        assert.match(
          await page.locator(".action-beat-text").textContent(),
          /^New game · This save cannot be opened by this version of the game\. It is kept until you start a new game\.$/u,
        );
        assert.equal(await status.isVisible(), false, "no dead-end notice");
        assert.equal(await actionLabel(button), "Start a new game");
        assert.equal(await button.textContent(), "Tap to start a new game");
        assert.equal(await button.getAttribute("data-destructive"), null);
        let box,
          settled = await beat.boundingBox();
        do {
          box = settled;
          await page.waitForTimeout(150);
          settled = await beat.boundingBox();
        } while (settled.y !== box.y);
        await page.mouse.click(box.x + box.width / 2, box.y + 12);
        await page.waitForFunction(
          () =>
            document.querySelector("#setting-new-game")?.textContent ===
            "Tap again to replace this world",
        );
        assert.equal(await button.getAttribute("data-destructive"), "");
        assert.equal(
          await page.evaluate((key) => localStorage.getItem(key), key),
          spec.save,
          "the first tap keeps the save",
        );
        await page.waitForTimeout(450);
        await button.click();
        await page.waitForFunction(
          (key) => JSON.parse(localStorage.getItem(key)).turn === 0,
          key,
        );
        assert.equal(
          await page.evaluate((key) => localStorage.getItem(`${key}.bak`), key),
          spec.save,
          "the replaced save is archived",
        );
        assert.equal(await page.locator("#setting-new-game").count(), 0);
        report.freshStart = true;
      } else if (spec.notice) {
        await status.waitFor({ state: "visible" });
        report.notice = await status.textContent();
        assert.match(report.notice, spec.notice, `${name} notice`);
      } else {
        await page.locator("#hand .card").first().waitFor();
        await page.waitForTimeout(500);
        assert.equal(await status.isVisible(), false, "fresh boot: no notice");
        assert.deepEqual(report.console, [], "fresh boot: no console error");
      }
      // A retired save is replaced by the fresh table's first save; a corrupt
      // one is kept for the player until New game.
      if (spec.replaced) {
        const text = await page.evaluate(
          (key) => localStorage.getItem(key),
          key,
        );
        assert.equal(JSON.parse(text).schema, 8, "retired save replaced");
      } else if (spec.save && !spec.freshStart)
        assert.equal(
          await page.evaluate((key) => localStorage.getItem(key), key),
          spec.save,
        );
      assert.deepEqual(report.errors, [], `${name} boot throws nothing`);
      report.passed = true;
      await page.close();
    }
} finally {
  await browser.close();
  server.close();
  console.log(JSON.stringify(results, null, 2));
}
