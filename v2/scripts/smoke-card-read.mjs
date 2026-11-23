// Reading the River Notebook shows its claims on its pages; closing refocuses it.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { packDefinition } from "../card-game/pack-registry.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import {
  focusedHandCard,
  readyActionButton,
  selectCard,
} from "./card-browser-helpers.mjs";

const BOOK = "willows-notebook";
const book = packDefinition("willows").items[BOOK];
const output = new URL("../../output/read-view/", import.meta.url);
await mkdir(output, { recursive: true });
const world = createWorld({ seed: 7 });
world.actors.vale.place = "willows-camp";
world.items[BOOK].holder = "vale";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "read-fixture",
          entries: c.entities.map(({ id }) => ({ id, text: "The river runs high." })),
        }),
      });
    });
    const key = `cosyworld.reflected-shore.v1.read-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(world) },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=read-${width}`,
    );
    await page.locator('#hand [data-card="vale"]').waitFor();
    await selectCard(page, BOOK, { touch: width === 390 });
    await readyActionButton(page, "read").click();
    const dialog = page.locator("dialog[open]", { hasText: book.name });
    await dialog.waitFor();
    assert.equal(await dialog.locator("h2").textContent(), book.name);
    assert.equal(await dialog.locator(".kicker").textContent(), "by The Swede");
    const lines = await dialog.locator("p:not(.kicker)").evaluateAll((ps) =>
      ps.map((p) => [p.textContent, getComputedStyle(p).backgroundImage]),
    );
    assert.deepEqual(
      lines.map(([text]) => text),
      book.claims.map((claim) => claim.text),
    );
    for (const [n, [, art]] of lines.entries()) {
      assert.match(art, new RegExp(`notebook-page-${n + 1}\\.webp`), art);
      const url = art.slice(5, -2);
      assert.equal(await page.evaluate(async (u) => (await fetch(u)).status, url), 200);
    }
    await page.screenshot({ path: new URL(`read-${width}.png`, output).pathname });
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.waitForFunction(() =>
      document.activeElement?.matches("#hand .card"),
    );
    assert.equal(await focusedHandCard(page), BOOK, `focus at ${width}`);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Read view smoke passed.");
} finally {
  await browser.close();
  server.close();
}
