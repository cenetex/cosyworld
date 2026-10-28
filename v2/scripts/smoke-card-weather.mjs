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
import { selectCard } from "./card-browser-helpers.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { questCards } from "../card-game/quest-cards.mjs";

const output = new URL("../../output/card-weather/", import.meta.url);
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
          model: "weather-fixture",
          entries: context.entities.map(({ id }) => ({
            id,
            text: "We have time to watch the sky.",
          })),
        },
      });
    });
    const table = `weather-${width}`;
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
      const world = createWorld({ packScopes: { "greek-drama": "full" } });
      world.actors.vale.place = place;
      world.turn = world.revision = turn;
      enableMotives(world, { questPrograms: true, personalQuests: true });
      await page.evaluate(
        ({ key, save, seen, quests }) => {
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
          localStorage.setItem(
            `${key}.quests`,
            JSON.stringify({ seen: quests, read: quests }),
          );
        },
        {
          key,
          save: encodeSave(world),
          seen: [
            ...Object.keys(places),
            ...Object.keys(people),
            ...Object.keys(things),
          ],
          quests: Object.keys(people).flatMap((id) =>
            questCards(world, id).map((quest) => quest.key),
          ),
        },
      );
      await page.reload();
      await page.waitForFunction(
        (place) =>
          document.body.dataset.place === place && !document.body.inert,
        place,
      );
      return world;
    }
    async function check(place, turn, name) {
      const weather = locationWeather({ turn }, place);
      const stage = page.locator("#stage");
      assert.equal(
        await stage.getAttribute("data-weather"),
        weather?.condition || null,
      );
      assert.equal(
        await stage.getAttribute("data-weather-variant"),
        weather?.variant || null,
      );
      if (weather) {
        const currentArt = page.locator(`#hand [data-card="${place}"] .art`);
        assert.equal(
          await currentArt.getAttribute("data-weather"),
          weather.condition,
        );
        if (weather.condition === "rain")
          assert(
            (
              await currentArt
                .locator("img")
                .first()
                .evaluate((img) => getComputedStyle(img).filter)
            ).includes("brightness(0.68)"),
          );
      }
      for (const art of await page
        .locator("#hand .location .art[data-weather]")
        .all()) {
        const id = await art.locator("..").getAttribute("data-card");
        const expected = locationWeather({ turn }, id);
        assert.equal(
          await art.getAttribute("data-weather-region"),
          expected.region,
        );
        assert.equal(
          await art.getAttribute("data-weather"),
          expected.condition,
        );
      }
      if (weather?.condition === "rain") {
        const rain = await stage
          .locator(":scope > .weather-layer")
          .evaluate((layer) => {
            const style = getComputedStyle(layer, "::after");
            return {
              display: style.display,
              animation: style.animationName,
              background: style.backgroundImage,
            };
          });
        assert.equal(rain.display === "none", weather.exposure === "shelter");
        if (weather.exposure !== "shelter") {
          assert(rain.background.includes("repeating-linear-gradient"));
          assert.equal(rain.animation, width === 390 ? "none" : "scene-rain");
        }
      }
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
      await page.evaluate(async () => {
        await Promise.all(
          [...document.querySelectorAll("#backdrop,#cast img,#hand img")].map(
            (img) => img.decode(),
          ),
        );
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        await Promise.allSettled(
          document
            .getAnimations()
            .filter(
              (animation) =>
                animation.effect.getTiming().iterations !== Infinity,
            )
            .map((animation) => animation.finished),
        );
      });
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: new URL(`${name}-${width}.png`, output).pathname,
      });
      report.push({ width, place, turn, weather, passed: true });
    }
    await load("greek-courtyard", 11);
    await check("greek-courtyard", 11, "clear-courtyard");
    await selectCard(page, "vale", { touch: width === 390 });
    await page.locator('#card-actions [data-action="wait"]').click();
    await page.waitForFunction(
      ({ key }) => JSON.parse(localStorage.getItem(key)).turn === 12,
      { key },
    );
    await check("greek-courtyard", 12, "cloud-after-play");
    for (const [place, turn, name] of [
      ["greek-harbor", 24, "rain-coast"],
      ["greek-courtyard", 24, "rain-courtyard"],
      ["greek-sanctuary", 24, "rain-grove"],
      ["greek-colonus", 60, "mist-grove"],
      ["greek-thinkery", 36, "rain-shelter"],
      ["greek-underworld", 36, "underworld-mist"],
    ]) {
      await load(place, turn);
      await check(place, turn, name);
      await page.reload();
      await page.waitForFunction(
        (place) =>
          document.body.dataset.place === place && !document.body.inert,
        place,
      );
      assert.equal(
        await page.locator("#stage").getAttribute("data-weather"),
        locationWeather({ turn }, place).condition,
      );
    }
    await load("pond", 24);
    await check("pond", 24, "shore");
    assert.equal(await page.locator("#stage > .weather-layer").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Weather browser checks passed: ${report.length} scenes at desktop and phone widths.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
