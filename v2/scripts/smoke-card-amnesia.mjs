// A new game wakes Vale knowing nothing (#1575): until its player uncovers a
// card, the screen and Vale's speech never name it.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { revealCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL(
  process.env.AMNESIA_SHOTS || "../../output/amnesia/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const names = { vale: "Vale", lamp: "Lamp", attic: "Mirror attic", world: "reflected shore" };
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.setDefaultTimeout(20000);
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
    });
    // At phone width the voice fails: no line is scripted, Vale shows "…".
    const voiceFails = width < 400;
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (voiceFails)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Model unavailable." }),
        });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "amnesia-fixture",
          entries: input.entities.map(({ id }) => ({ id, text: "Where am I?" })),
        }),
      });
    });
    // Every name a viewer or a screen reader could meet on the page.
    const named = () =>
      page.evaluate(() => {
        const text = [document.body.innerText, document.title];
        for (const el of document.querySelectorAll("[aria-label], [alt]"))
          text.push(el.getAttribute("aria-label") || "", el.getAttribute("alt") || "");
        for (const el of document.querySelectorAll(".sr-only")) text.push(el.textContent);
        return text.join("\n");
      });
    const mentions = async (word) => new RegExp(`\\b${word}\\b`, "i").test(await named());
    const uncover = (id) => page.locator(`#hand [data-card="${id}"]`).click();
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/?table=amnesia-${width}`);
      await page.waitForFunction(
        () => document.querySelector("#hand").dataset.cooling === "false",
      );
      for (const word of Object.values(names))
        assert(!(await mentions(word)), `${word} was named before uncovering at ${width}px`);
      assert.equal(await page.locator("#place-title").textContent(), "…");
      assert.equal(requests.length, 0, "Vale spoke before he knew himself");
      await page.screenshot({ path: new URL(`before-${width}.png`, output).pathname });
      // Knowing himself is not enough: the line waits for the place too.
      await uncover("vale");
      assert(await mentions(names.vale));
      assert(!(await mentions(names.attic)));
      assert.equal(requests.length, 0);
      await uncover("attic");
      if (voiceFails)
        await page.waitForFunction(
          () => document.querySelector("#dialogue-text")?.textContent.trim() === "…",
        );
      else await page.waitForFunction(() => /Where am I/.test(document.body.innerText));
      assert(!/remember how I got here/.test(await named()), "A scripted line showed");
      assert(await mentions(names.attic));
      assert(await mentions(names.world));
      // The raw waking frame (#1600); the covered lamp never reaches it.
      assert(requests.length >= 1);
      assert.equal(requests[0].waking, true);
      assert.equal(requests[0].covered, undefined);
      const sent = JSON.stringify(requests[0]);
      assert(!/lamp/i.test(sent), `The opening request named the lamp: ${sent}`);
      assert(!(await mentions(names.lamp)));
      await revealCard(page, "lamp");
      assert(await mentions(names.lamp));
      await page.screenshot({ path: new URL(`after-${width}.png`, output).pathname });
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  console.log("Amnesia smoke passed: names and speech follow uncovered cards.");
} finally {
  await browser.close();
  server.close();
}
