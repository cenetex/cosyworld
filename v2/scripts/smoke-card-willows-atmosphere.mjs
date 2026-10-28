import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  places,
  people,
  things,
} from "../card-game/world.mjs";
import { locationWeather } from "../card-game/weather.mjs";
import { locationDaylight } from "../card-game/daylight.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/willows-atmosphere/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: width === 390 ? "reduce" : "no-preference",
      hasTouch: width === 390,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url().includes("/assets/"))
        errors.push(`${response.status()} ${response.url()}`);
    });
    await page.route("**/card-game/text", (route) => {
      const context = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: context.revision,
          model: "willows-sky-fixture",
          entries: context.entities.map(({ id }) => ({
            id,
            text: "The river carries the light between the willows.",
          })),
        },
      });
    });
    const table = `willows-sky-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false, volume: 0 }),
      );
    });
    await page.goto(`${origin}/?table=${table}`);
    async function load(place, turn) {
      const world = createWorld();
      world.actors.vale.place = place;
      world.turn = world.revision = turn;
      for (const item of [
        "paddle",
        "map",
        "rope",
        "sheet",
        "provisions",
        "pot",
        "spoon",
        "pipe",
      ])
        world.items[`willows-${item}`].holder = "vale";
      enableMotives(world, { questPrograms: true, personalQuests: true });
      await page.evaluate(
        ({ key, save, seen }) => {
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        },
        {
          key,
          save: encodeSave(world),
          seen: [
            ...Object.keys(places),
            ...Object.keys(people),
            ...Object.keys(things),
          ],
        },
      );
      await page.reload();
      await page.waitForFunction(
        (place) =>
          document.body.dataset.place === place && !document.body.inert,
        place,
      );
    }
    async function check(place, turn, capture = false) {
      const weather = locationWeather({ turn }, place),
        daylight = locationDaylight({ turn }, place);
      const stage = page.locator("#stage");
      assert.equal(await stage.getAttribute("data-weather-region"), "danube");
      assert.equal(await stage.getAttribute("data-weather"), weather.condition);
      assert.equal(
        await stage.getAttribute("data-time-of-day"),
        daylight.phase,
      );
      assert.equal(await stage.getAttribute("data-exposure"), weather.exposure);
      const card = page.locator(`#hand [data-card="${place}"] .art`);
      assert.equal(await card.getAttribute("data-weather"), weather.condition);
      assert.equal(await card.getAttribute("data-time-of-day"), daylight.phase);
      const light = await stage.evaluate((el) => ({
        filter: getComputedStyle(el.querySelector(".backdrop")).filter,
        sky: getComputedStyle(el.querySelector(".weather-layer"), "::before")
          .backgroundImage,
        shader: el.querySelector(".weather-layer").dataset.shader,
      }));
      assert.equal(light.shader, "webgl");
      if (daylight.phase === "night")
        assert(light.filter.includes("brightness(0.34)"));
      if (daylight.phase !== "day")
        assert(light.sky.includes("linear-gradient"));
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#backdrop,#hand img")].every(
          (img) => img.complete && img.naturalWidth,
        ),
      );
      if (capture) {
        await page.keyboard.press("Escape");
        await page.screenshot({
          path: new URL(
            `${place}-${daylight.phase}-${weather.condition}-${width}.png`,
            output,
          ).pathname,
        });
      }
      report.push({ width, place, turn, weather, daylight, light });
    }
    for (const place of [
      "willows-landing",
      "willows-camp",
      "willows-thicket",
      "willows-bank",
    ]) {
      for (const turn of [0, 12, 24, 36, 48]) {
        await load(place, turn);
        await check(place, turn, true);
      }
    }
    await load("willows-camp", 23);
    await selectCard(page, "vale", { touch: width === 390 });
    await page.locator('#card-actions [data-action="wait"]').click();
    await page.waitForFunction(
      (key) => JSON.parse(localStorage.getItem(key)).turn === 24,
      key,
    );
    await check("willows-camp", 24);
    await page.reload();
    await page.waitForFunction(
      () =>
        document.body.dataset.place === "willows-camp" && !document.body.inert,
    );
    await check("willows-camp", 24);
    for (const item of [
      "paddle",
      "map",
      "rope",
      "sheet",
      "provisions",
      "pot",
      "spoon",
      "pipe",
    ]) {
      await selectCard(page, `willows-${item}`, { touch: width === 390 });
      const card = page.locator(`#hand [data-card="willows-${item}"]`);
      assert(
        await card
          .locator("img")
          .first()
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      );
      assert(
        (await card.locator("img").first().getAttribute("src")).endsWith(
          ".webp",
        ),
      );
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#stage > .weather-layer").evaluate((layer) => {
      delete layer.dataset.shader;
      layer.querySelector("canvas").style.display = "none";
    });
    assert(
      (
        await page
          .locator("#stage > .weather-layer")
          .evaluate(
            (layer) => getComputedStyle(layer, "::before").backgroundImage,
          )
      ).includes("linear-gradient"),
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `Willows sky passed: ${report.length} views, desktop and phone, eight item cutouts, accepted wait and reload.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
