// Joining, leaving or taking a seat loads a new page (avatar-menu.mjs). The
// page fades to black first, and the next page opens on that black, lifts
// it and deals its hand (page-fade.mjs, card-entry.mjs). Desktop, phone and
// reduced motion, through the seat change's reload.
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
    [390, 844, "no-preference"],
    [390, 844, "reduce"],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: motion,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      // How black the page is at its first frames, and each card dealt.
      window.arrival = { black: [], dealt: 0 };
      const look = () => {
        const black = document.querySelector(".page-fade");
        window.arrival.black.push(black ? getComputedStyle(black).opacity : 0);
        if (window.arrival.black.length < 120) requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.matches?.(".hand > .card-frame")) window.arrival.dealt++;
        return animate.call(this, frames, options);
      };
    });
    await page.goto(`${origin}/?table=page-fade-${width}-${motion}`);
    await page.locator("#hand .card").first().waitFor();
    // Leaving fades to black before the page goes.
    const left = await page.evaluate(async () => {
      const { leavePage } = await import("/card-game/page-fade.mjs");
      let blackAtGo;
      await leavePage(() => {
        blackAtGo = getComputedStyle(
          document.querySelector(".page-fade"),
        ).opacity;
      });
      return blackAtGo;
    });
    assert.equal(left, "1", "the page is black before it goes");
    await page.reload();
    await page.locator("#hand .card").first().waitFor();
    await page.waitForFunction(() => !document.querySelector(".page-fade"));
    const { black, dealt } = await page.evaluate(() => window.arrival);
    assert(
      Number(black.find((o) => o !== 0)) > 0.5,
      `opens on black: ${black}`,
    );
    if (motion === "reduce") assert.equal(dealt, 0, "reduced motion");
    else assert(dealt > 0, `the hand is dealt: ${dealt}`);
    // A page opened without leaving has no black.
    await page.reload();
    await page.locator("#hand .card").first().waitFor();
    assert.equal(await page.locator(".page-fade").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Leaving faded to black and the next page lifted it at ${width}px (${motion}).`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
