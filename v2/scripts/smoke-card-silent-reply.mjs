// A reply speaker whose words do not come shows "…", unvoiced and unsaved.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

let fixture = enableMotives(createWorld({ opening: true }));
for (const kind of ["light", "move"])
  fixture = play(
    fixture,
    legalActions(fixture).find(
      (a) => a.kind === kind && (kind !== "move" || a.target === "pond"),
    ),
  ).state;
const save = encodeSave(fixture),
  key = "cosyworld.reflected-shore.v1.silent-reply";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir("output/silent-reply", { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [];
    let quiet = null;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(
          `${key}.seen`,
          JSON.stringify(["vale", "moth", "keeper", "lamp", "attic", "pond"]),
        );
      },
      { key, save },
    );
    // The stub provider leaves the reply speaker's words out.
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      quiet = input.speakers.length > 1 ? input.speakers.at(-1) : null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "browser-fixture",
          entries: input.entities
            .filter(({ id }) => id !== quiet)
            .map(({ id }) => ({
              id,
              text: `${id} speaks on turn ${input.turn}.`,
            })),
          omitted: quiet ? [quiet] : [],
        }),
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=silent-reply`,
    );
    await page.locator('#hand [data-card="moth"]').click();
    await page.locator("#card-actions .card-primary").click();
    const shown = new Set();
    for (let i = 0; i < 250; i++) {
      shown.add((await page.textContent("#dialogue-text"))?.trim());
      if (
        (await page.locator("#hand").getAttribute("data-cooling")) ===
          "false" &&
        shown.has("…")
      )
        break;
      if (await page.locator("#dialogue-advance").isVisible())
        await page.locator("#dialogue-advance").click();
      await page.waitForTimeout(40);
    }
    assert.equal(quiet, "moth");
    assert(shown.has("…"), `The stage never showed "…": ${[...shown]}`);
    await page.evaluate(() =>
      document.querySelector("#history-button").click(),
    );
    assert.match(await page.textContent("#messages"), /Pip\s*…/u);
    await page.evaluate(() =>
      document.querySelector("#history-dialog").close(),
    );
    await page.screenshot({ path: `output/silent-reply/silent-${width}.png` });
    const saved = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    assert.equal(
      saved.log.some((entry) => entry.silent || entry.text === "…"),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(`A silent reply showed "…" without saving at ${width}px.`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
