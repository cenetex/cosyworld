import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { courtJourney, FROGS } from "../../test/helpers/greek-readings.mjs";

export async function checkReadings(browser, origin) {
  const output =
    process.env.COSYWORLD_READING_EVIDENCE ||
    "/private/tmp/cosyworld-reading-browser";
  await mkdir(output, { recursive: true });
  const initial = courtJourney(),
    id = `site:${FROGS}-court:vale`,
    report = [];
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
    });
    const key = `cosyworld.reflected-shore.v1.readings-${width}`,
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(initial), seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "reading-browser-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: "I am listening to the account.",
          })),
        },
      });
    });
    const saved = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const settle = async () => {
      for (let i = 0; i < 300; i++) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        assert.equal(await page.locator("#story-retry").isVisible(), false);
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(40);
      }
      throw Error("The reading stayed busy.");
    };
    const open = async () => {
      await page.locator("#toolbar-menu-button").click();
      await page.locator("#reading-button").click();
      await page.locator("#reading-dialog[open]").waitFor();
    };
    try {
      await page.goto(`${origin}/?table=readings-${width}`);
      await page.locator("#hand .card").first().waitFor();
      await settle();
      await open();
      await page
        .getByRole("button", {
          name: "Begin the reading before both poets",
          exact: true,
        })
        .click();
      await page.waitForFunction(
        ({ key, id }) =>
          JSON.parse(localStorage.getItem(key)).packs["greek-drama"]
            .poemReadings.readings[id],
        { key, id },
      );
      await settle();
      const started = (await saved()).packs["greek-drama"].poemReadings
        .readings[id];
      await open();
      assert.equal(await page.locator(".reading-verses blockquote").count(), 4);
      assert.match(
        await page.locator("#reading-dialog").innerText(),
        /Original author: Vale/,
      );
      await page.getByRole("button", { name: /^Read page 1 of/ }).click();
      await page.waitForFunction(
        ({ key, id }) =>
          JSON.parse(localStorage.getItem(key)).packs["greek-drama"]
            .poemReadings.readings[id].pages.length === 1,
        { key, id },
      );
      await settle();
      const published = (await saved()).packs["greek-drama"].poemReadings
        .readings[id];
      await open();
      const beforeReview = (await saved()).turn;
      await page
        .getByRole("button", { name: "Next page", exact: true })
        .click();
      assert.match(
        await page.locator("#reading-dialog").innerText(),
        /Ready to read/,
      );
      assert.equal((await saved()).turn, beforeReview);
      await page
        .getByRole("button", { name: "Previous page", exact: true })
        .click();
      await page.screenshot({ path: `${output}/reading-${width}.png` });
      await page
        .getByRole("button", { name: /Read page 1 .* again to Aeschylus/ })
        .click();
      await page.waitForFunction(
        ({ key, turn }) => JSON.parse(localStorage.getItem(key)).turn > turn,
        { key, turn: beforeReview },
      );
      await settle();
      await page.reload();
      await page.locator("#hand .card").first().waitFor();
      await settle();
      const replayed = (await saved()).packs["greek-drama"].poemReadings
        .readings[id];
      assert.equal(replayed.turn, started.turn);
      assert.equal(replayed.through, started.through);
      assert.deepEqual(replayed.pages, published.pages);
      assert.deepEqual(replayed.selection, started.selection);
      await open();
      const bounds = await page.locator("#reading-dialog").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert.deepEqual(errors, []);
      report.push({
        width,
        pageStanzas: 4,
        readonlyReview: true,
        originalPageRetained: true,
        reload: true,
        errors,
      });
    } finally {
      await page.close();
    }
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    await checkReadings(browser, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
