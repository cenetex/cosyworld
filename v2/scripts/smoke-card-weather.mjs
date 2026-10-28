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
    async function load(place, turn, shipAtHarbor = false) {
      const world = createWorld({ packScopes: { "greek-drama": "full" } });
      world.actors.vale.place = place;
      world.turn = world.revision = turn;
      if (shipAtHarbor) {
        world.crossings["pond-greek-harbor"].discovered = true;
        world.transports["greek-ship"].dock = place;
      }
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
      const daylight = locationDaylight({ turn }, place);
      const stage = page.locator("#stage");
      assert.equal(
        await stage.getAttribute("data-time-of-day"),
        daylight?.phase || "day",
      );
      const night = daylight?.phase === "night";
      assert.equal(
        new URL(
          await page.locator("#backdrop").getAttribute("src"),
          origin,
        ).pathname.endsWith("-night.webp"),
        night,
      );
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
        assert.equal(
          await currentArt.getAttribute("data-time-of-day"),
          daylight?.phase || "day",
        );
        if (weather.condition === "rain")
          assert(
            (
              await currentArt
                .locator("img")
                .first()
                .evaluate((img) => getComputedStyle(img).filter)
            ).includes(
              `brightness(${daylight?.phase === "night" ? "0.9" : weather.exposure === "shelter" ? "0.92" : "0.68"})`,
            ),
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
      if (weather) {
        // The stage paints weather with a WebGL shader; cards reuse stills.
        const shader = await stage
          .locator(":scope > .weather-layer")
          .evaluate((layer) => {
            const canvas = layer.querySelector("canvas");
            const gl = canvas?.getContext("webgl");
            const pixels = new Uint8Array(4 * 64);
            gl?.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            return {
              shader: layer.dataset.shader,
              size: canvas ? [canvas.width, canvas.height] : null,
              painted: pixels.some((value) => value > 0),
            };
          });
        assert.equal(shader.shader, "webgl");
        assert(shader.size[0] > 0 && shader.size[1] > 0);
        if (weather.condition !== "clear") assert(shader.painted);
        if (weather.condition !== "clear")
          assert.match(
            await page
              .locator(`#hand [data-card="${place}"] .art > .weather-layer`)
              .evaluate((layer) => layer.style.backgroundImage),
            /^url\("data:image\/png/,
          );
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
      report.push({ width, place, turn, weather, daylight, passed: true });
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
    await load("greek-courtyard", 23);
    await check("greek-courtyard", 23, "before-night");
    await selectCard(page, "vale", { touch: width === 390 });
    await page.locator('#card-actions [data-action="wait"]').click();
    await page.waitForFunction(
      ({ key }) => JSON.parse(localStorage.getItem(key)).turn === 24,
      { key },
    );
    await check("greek-courtyard", 24, "night-after-play");
    assert(
      new URL(
        await page
          .locator('#hand [data-card="greek-harbor"] img')
          .getAttribute("src"),
        origin,
      ).pathname.endsWith("harbor-open-berth-night.webp"),
    );
    await load("greek-harbor", 24, true);
    await check("greek-harbor", 24, "night-harbor-ship");
    assert(
      new URL(
        await page.locator("#backdrop").getAttribute("src"),
        origin,
      ).pathname.endsWith("harbor-ship-at-berth-night.webp"),
    );
    for (const [place, day, night] of [
      [
        "greek-athens-harbor",
        "athens-harbor.webp",
        "athens-harbor-ship-at-berth-night.webp",
      ],
      [
        "greek-piraeus",
        "open-door-piraeus.webp",
        "piraeus-ship-at-berth-night.webp",
      ],
    ]) {
      for (const turn of [0, 24]) {
        await load(place, turn, true);
        await check(
          place,
          turn,
          `${place}-ship-${turn === 24 ? "night" : "day"}`,
        );
        assert(
          new URL(
            await page.locator("#backdrop").getAttribute("src"),
            origin,
          ).pathname.endsWith(turn === 24 ? night : day),
        );
      }
    }
    for (const [place, turn, name] of [
      ["greek-harbor", 24, "rain-coast"],
      ["greek-courtyard", 24, "rain-courtyard"],
      ["greek-sanctuary", 24, "rain-grove"],
      ["greek-well", 24, "night-well"],
      ["greek-gate", 24, "night-gate"],
      ["greek-palace", 24, "night-palace"],
      ["greek-battlefield", 24, "night-battlefield"],
      ["greek-piraeus", 0, "piraeus-open-day"],
      ["greek-piraeus", 24, "piraeus-open-night"],
      ["greek-athens-harbor", 0, "athens-open-day"],
      ["greek-athens-harbor", 24, "athens-open-night"],
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
