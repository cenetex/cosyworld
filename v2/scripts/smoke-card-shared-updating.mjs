// A shared world opened during a release swap waits on its "Updating" card
// (shared.mjs). Each retry's words come in over the old ones rather than
// cutting, and when the world opens the card fades out over the table,
// which it stops holding at once. Desktop, phone and reduced motion.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height, motion] of [
    [1440, 900, "no-preference"],
    [390, 844, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/auth/account", (r) =>
      r.fulfill({ json: { authenticated: true } }),
    );
    // Updating twice, then open.
    let opens = 0;
    await page.route("**/card-game/shared/worlds/swap-world**", (r) =>
      ++opens <= 2
        ? r.fulfill({
            status: 503,
            json: { error: "This world is updating.", code: "updating" },
          })
        : r.fulfill({
            json: { actor: "vale", now: Date.now(), world: { revision: 1 } },
          }),
    );
    await page.goto(`${origin}/card-game/privacy.html`);
    await page.evaluate(async () => {
      window.watch = { crossed: 0, faded: false, modalAtFade: null };
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const lobby = document.getElementById("shared-lobby");
        if (lobby?.contains(this) && this !== lobby) window.watch.crossed++;
        if (this === lobby && frames.opacity?.[1] === 0) {
          window.watch.faded = options.duration;
          window.watch.modalAtFade = lobby.matches(":modal");
        }
        return animate.call(this, frames, options);
      };
      const { connectSharedWorld } = await import("/card-game/shared.mjs");
      window.opened = connectSharedWorld("swap-world").then(() => true);
    });
    await page.locator("#shared-lobby[open]").waitFor();
    assert.match(
      await page.locator("#shared-lobby").innerText(),
      /Updating — back in a moment/,
    );
    // The retry redraws the card: its words cross in.
    await page.waitForFunction(() => window.watch.crossed > 0, null, {
      timeout: 10000,
    });
    // The world opens: the card fades out, no longer holding the page.
    assert.equal(await page.evaluate(() => window.opened), true);
    await page.waitForFunction(() => window.watch.faded);
    const watch = await page.evaluate(() => window.watch);
    assert.equal(watch.faded, 200, "the card fades out over 200 ms");
    assert.equal(watch.modalAtFade, false, "the table takes taps at once");
    await page.waitForFunction(
      () => !document.querySelector("#shared-lobby[open]"),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`The Updating card crossed and faded out at ${width}px.`);
  }
} finally {
  await browser.close();
  server.close();
}
