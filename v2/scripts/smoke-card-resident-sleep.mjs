// Approved resident sleep art follows the saved sleep state in the hand and
// scene, then returns to the resident's ordinary portrait after wake.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { SAVE_BASE } from "../card-game/avatar-world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import {
  encodeSave,
  decodeSave,
  createWorld,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { selectCard, smokeWidths } from "./card-browser-helpers.mjs";

const widths = smokeWidths([1440, 390]);
const residents = [
  {
    id: "greek-baker",
    place: "greek-courtyard",
    art: "./assets/sleep/greek-baker-sleeping.png",
    awakeArt: "./assets/greek-drama/chthonic-baker.png",
  },
  {
    id: "greek-antigone",
    place: "greek-gate",
    art: "./assets/sleep/residents/greek-antigone-sleeping.png",
    awakeArt: "./assets/greek-drama/chthonic-antigone.png",
  },
];
const cases = widths.flatMap((width) =>
  residents.map((resident) => ({ ...resident, width })),
);
const output = resolve(
  process.env.COSYWORLD_SLEEP_RESIDENT_FRAMES || "output/card-resident-sleep",
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ headless: true });

try {
  for (const { width, id, place, art, awakeArt } of cases) {
    const key = `${SAVE_BASE}.resident-sleep-${id}-${width}`;
    const world = createWorld({ packScopes: { "greek-drama": "full" } });
    world.turn = world.revision = 91;
    world.actors.vale.place = place;
    world.actors[id].place = place;
    world.packs["greek-drama"].met[id] = 0;
    world.actors[id].sleeping = {
      since: 90,
      place,
      until: 96,
    };
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/card-game/text", (route) =>
      route.fulfill({ status: 503, json: { error: "fixture" } }),
    );
    await page.addInitScript(
      ({ key, save, seen }) => {
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      },
      { key, save: encodeSave(world), seen: availableCards(world) },
    );

    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=resident-sleep-${id}-${width}`,
      );
      const ready = async () => {
        for (let attempt = 0; attempt < 250; attempt++) {
          if (
            (await page.locator("#hand").getAttribute("data-cooling")) ===
            "false"
          )
            return;
          if (await page.locator("#dialogue-advance").isVisible())
            await page.locator("#dialogue-advance").click();
          await page.waitForTimeout(40);
        }
        throw new Error("The hand stayed busy.");
      };
      const card = page.locator(`#hand [data-card="${id}"] .art img`);
      await card.waitFor();
      const figure = page.locator(`#cast [data-avatar="${id}"]`);
      await figure.waitFor();
      await page.waitForFunction((id) => {
        const card = document.querySelector(
          `#hand [data-card="${id}"] .art img`,
        );
        const scene = document.querySelector(`#cast [data-avatar="${id}"] img`);
        return (
          card?.complete &&
          card.naturalWidth &&
          scene?.complete &&
          scene.naturalWidth
        );
      }, id);
      const sleepingFile = new RegExp(`${id}-sleeping`, "u");
      assert.match(await card.getAttribute("src"), sleepingFile);
      assert.equal(await figure.getAttribute("data-pose"), "sleep");
      assert.equal(
        await figure.locator("img").getAttribute("data-source"),
        art,
      );
      await page.screenshot({
        path: resolve(output, `asleep-${id}-${width}.png`),
      });

      const at95 = structuredClone(world);
      at95.turn = at95.revision = 95;
      const waitAt95 = legalActions(at95).find(
        (action) => action.kind === "wait" && !action.sleep && !action.guards,
      );
      assert(waitAt95);
      const awake = play(at95, waitAt95, at95.revision).state;
      assert.equal(awake.turn, 96);
      assert.equal(awake.actors[id].sleeping, undefined);
      let savedWorld = world;
      for (
        let attempt = 0;
        attempt < 8 && savedWorld.actors[id].sleeping;
        attempt++
      ) {
        await ready();
        await selectCard(page, place);
        await page.locator('#card-actions [data-action="wait"]').click();
        await ready();
        const saved = await page.evaluate(
          (saveKey) => localStorage.getItem(saveKey),
          key,
        );
        savedWorld = decodeSave(saved);
      }
      assert.equal(savedWorld.actors[id].sleeping, undefined);
      await page.waitForFunction(
        ({ id, awakeArt }) => {
          const img = document.querySelector(`#cast [data-avatar="${id}"] img`);
          return (
            img?.complete && img.naturalWidth && img.dataset.source === awakeArt
          );
        },
        { id, awakeArt },
      );
      assert.notEqual(
        await page
          .locator(`#cast [data-avatar="${id}"]`)
          .getAttribute("data-pose"),
        "sleep",
      );
      assert.doesNotMatch(await card.getAttribute("src"), sleepingFile);
      // Compare the retained live card with framing freshly computed from
      // the same awake pixels. Loading a new pose must not retain sleep fit.
      const fit = await card.evaluate(async (image) => {
        const { createFigureFramer } = await import("/figure-frame.mjs");
        const { frameFigure } = createFigureFramer(() => document.createElement("canvas"));
        await image.decode();
        const reference = new Image();
        reference.src = image.src;
        await reference.decode();
        frameFigure(reference);
        const keys = ["--figure-top", "--figure-height", "--head-x"];
        return {
          actual: keys.map((key) => image.style.getPropertyValue(key)),
          expected: keys.map((key) => reference.style.getPropertyValue(key)),
        };
      });
      assert.deepEqual(fit.actual, fit.expected, "awake card uses its own alpha framing");
      const geometry = await figure.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const stage = document.querySelector("#stage").getBoundingClientRect();
        return { top: box.top, height: box.height, stageTop: stage.top, stageHeight: stage.height };
      });
      console.log(JSON.stringify({ id, width, geometry }));

      await page.screenshot({
        path: resolve(output, `awake-${id}-${width}.png`),
      });
      assert.deepEqual(errors, []);
      console.log(`Resident sleep art for ${id} passed at ${width}px.`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
