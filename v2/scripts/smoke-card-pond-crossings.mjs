import { selectCard } from "./card-browser-helpers.mjs";
// Actual card UI, deterministic speech fixture, and saved crossing conditions.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave, addLog } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";

function fixture(place, lit = false) {
  const s = createWorld({ opening: true });
  // Isolate the signal puzzle from the bard's separate fresh-harbor voyage.
  s.actors["greek-rhapsode"].place = "attic";
  s.opening.crossed = true;
  s.locations.attic.anchored = true;
  s.opening.met.moth = 0;
  s.opening.met.keeper = 0;
  s.actors.vale.place = place;
  s.actors.moth.place = "station";
  s.actors.keeper.place = "station";
  s.items.lamp.holder = "vale";
  s.items.lamp.lit = lit;
  s.items.lamp.fuel = 12;
  s.items.bell.holder = "vale";
  s.items.cloth.holder = place === "pond" ? "vale" : "station";
  if (place === "clearing") {
    s.crossings["pond-clearing"].discovered = true;
    s.opening.met.badger = 0;
  }
  addLog(s, "World", "The traveller pauses at the crossing.", {
    kind: "narration",
    locationId: place,
    actorId: "vale",
  });
  return encodeSave(s);
}
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = "output/pond-crossings-check";
await mkdir(output, { recursive: true });
const results = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 1440 ? 900 : 844 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15_000);
    const key = `cosyworld.reflected-shore.v1.crossings-${width}`;
    const errors = [],
      failedAssets = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400 && new URL(r.url()).pathname.includes("/assets/"))
        failedAssets.push(`${r.status()} ${r.url()}`);
    });
    await page.addInitScript(
      ({ key, seen }) => {
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      },
      { key, seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "crossing-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: `${profiles[id]?.name || id} considers the witnessed result.`,
          })),
        }),
      });
    });
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const ready = async () => {
      for (let i = 0; i < 375; i++) {
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw new Error(`Hand stayed busy at ${width}px: ${errors.join("; ")}`);
    };
    const use = async (id) => {
      await ready();

      await selectCard(page, id);
      await page.locator("#card-actions .card-primary").click();
      await ready();
    };
    const pair = async (one, two) => {
      await ready();

      await selectCard(page, one);

      await selectCard(page, two);
      await page.locator("#card-actions .card-primary").click();
      await ready();
    };
    const signal = async ({ reloadHalfway = false } = {}) => {
      assert.equal(await card("greek-ship").count(), 0);
      await pair("cloth", "lamp");
      assert.equal((await state()).crossings["pond-greek-harbor"].phase, 1);
      await use("cloth");
      assert.equal((await state()).crossings["pond-greek-harbor"].phase, 2);
      if (reloadHalfway) {
        await page.reload();
        await ready();
        assert.equal((await state()).crossings["pond-greek-harbor"].phase, 2);
      }
      assert.equal(await card("greek-ship").count(), 0);
      await pair("cloth", "lamp");
      assert.equal((await state()).crossings["pond-greek-harbor"].phase, 3);
      assert.equal(await card("greek-ship").count(), 0);
      await use("cloth");
      assert.equal(await card("greek-ship").count(), 1);
    };
    const load = async (save) => {
      await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
        key,
        save,
      });
      await page.reload();
      await card("vale").waitFor({ state: "attached" });
      await ready();
    };
    const shot = async (name) => {
      await page.waitForFunction(() =>
        [
          ...document.querySelectorAll(
            "#backdrop, #cast img, #location-overlay:not([hidden])",
          ),
        ].every((img) => img.complete && img.naturalWidth > 0),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: `${output}/${name}-${width}.png`,
        fullPage: true,
      });
    };
    const ringClock = async () => {
      await ready();
      await page.locator('#hand [data-card="clearing"]').click();

      await page
        .getByRole("button", { name: "Ring the Steam Clock", exact: true })
        .click();
      await ready();
    };
    await page.goto(`${origin}/?table=crossings-${width}`);
    await card("vale").waitFor({ state: "attached" });
    await load(fixture("clearing"));
    assert.equal(await card("pond").count(), 0);
    await shot("clearing-silent");
    await ringClock();
    let s = await state();
    assert.equal(s.packs["badger-forest"].sounds["steam-clock"], s.turn + 3);
    assert.equal(await card("pond").count(), 1);
    assert.equal(s.actors.badger.awake, true);
    await shot("clearing-ringing");
    await page.reload();
    await ready();
    assert.equal(await card("pond").count(), 1);
    for (let i = 0; i < 3; i++) await use("clearing");
    assert.equal(await card("pond").count(), 0);
    await page.reload();
    await ready();
    assert.equal(await card("pond").count(), 0);
    await ringClock();
    await use("pond");
    assert.equal((await state()).actors.vale.place, "pond");
    await load(fixture("pond", true));
    await signal({ reloadHalfway: true });
    assert.equal(await card("greek-ship").count(), 1);
    assert.equal(
      await page.locator("#backdrop").getAttribute("data-location-variant"),
      "pond-greek-harbor",
    );
    assert.equal(await page.locator("#location-overlay").isVisible(), true);
    await shot("pond-ship");
    await use("bell");
    assert.equal(await card("greek-ship").count(), 1);
    assert.equal(await page.locator("#location-overlay").isVisible(), true);
    await shot("pond-ringing");
    for (let i = 0; i < 3; i++) await use("pond");
    assert.equal(await card("greek-ship").count(), 1);
    await load(fixture("pond", true));
    await signal();
    // A genuine cross-tab save update invalidates the selected boarding offer.
    await selectCard(page, "greek-ship");
    s = await state();
    s.transports["greek-ship"].dock = "greek-harbor";
    s.revision++;
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(s) },
    );
    await ready();
    assert.equal(await card("greek-ship").count(), 0);
    assert.equal(await page.locator("#location-overlay").isVisible(), false);
    assert.equal((await state()).actors.vale.place, "pond");
    await load(fixture("pond", true));
    await signal({ reloadHalfway: true });
    await use("greek-ship");
    assert.equal((await state()).actors.vale.place, "greek-ship");
    assert.equal(await card("greek-harbor").count(), 1);
    assert.equal(await card("pond").count(), 0);
    assert.match(
      await page.locator("#backdrop").getAttribute("src"),
      /ship-deck\.webp$/,
    );
    await shot("aboard-ship");
    await page.reload();
    await ready();
    assert.equal((await state()).actors.vale.place, "greek-ship");
    await use("greek-harbor");
    assert.equal((await state()).actors.vale.place, "greek-harbor");
    for (let i = 0; i < 12; i++) await use("greek-harbor");
    assert.equal((await state()).items.lamp.lit, false);
    await use("greek-ship");
    await use("pond");
    assert.equal((await state()).actors.vale.place, "pond");
    assert.equal(await card("greek-ship").count(), 1);
    assert.equal(await page.locator("#location-overlay:visible").count(), 1);
    await shot("pond-returned-ship");
    assert.deepEqual(errors, []);
    assert.deepEqual(failedAssets, []);
    results.push({
      width,
      passed: true,
      requests: requests.length,
      pageErrors: errors,
      failedAssets,
    });
    await page.close();
  }
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log("Pond crossing browser checks passed", results);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
