import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { backdrop } from "../card-game/scene.mjs";
import {
  argosPaintings,
  argosPaintingWorld,
  shipPaintingWorld,
} from "../../test/helpers/painted-travel.mjs";

const output = new URL("../../output/painted-travel/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const cases = [];
for (const night of [false, true]) {
  for (const phase of ["docked", "sea", "arrived"])
    cases.push({
      name: `ship-${phase}-${night ? "night" : "day"}`,
      world: shipPaintingWorld(phase, night),
      door: false,
    });
  for (const [place, account] of argosPaintings)
    cases.push({
      name: `${place}-${night ? "night" : "day"}`,
      world: argosPaintingWorld(place, account, night),
      door: true,
    });
}
const results = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        }
      : {}),
  });
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const { name, world, door } of cases) {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("response", (r) => {
        if (r.status() >= 400 && r.url().includes("/assets/"))
          errors.push(r.url());
      });
      const table = `painted-${name}-${width}`;
      const key = `cosyworld.reflected-shore.v1.${table}`;
      const expected = backdrop(world.actors.vale.place, world)
        .split("/")
        .at(-1);
      await page.addInitScript(
        ({ key, save }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, save);
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
          localStorage.setItem("cosyworld.scares", "off");
        },
        { key, save: encodeSave(world) },
      );
      await page.goto(`${origin}/?table=${table}`);
      let screenshot;
      const inspect = async () => {
        await page.waitForFunction((file) => {
          const image = document.querySelector("#backdrop");
          return (
            image?.complete &&
            image.naturalWidth &&
            new URL(image.src).pathname.endsWith(file)
          );
        }, expected);
        await page.waitForFunction(() => {
          const images = [
            ...document.querySelectorAll(
              "#cast .portrait-body > img, #hand img",
            ),
          ];
          return (
            images.length > 0 &&
            images.every((image) => image.complete && image.naturalWidth > 0)
          );
        });
        const geometry = await page.evaluate(
          async ({ door }) => {
            await Promise.all(
              [
                ...document.querySelectorAll("#backdrop, #cast img, #hand img"),
              ].map((image) => image.decode()),
            );
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
            const frame = document
              .querySelector(".stage")
              .getBoundingClientRect();
            const painting = document
              .querySelector(".stage-figures")
              .getBoundingClientRect();
            const doorway = painting.x + (painting.width * 517) / 1672;
            return {
              fits: document.documentElement.scrollWidth <= innerWidth + 1,
              doorVisible:
                !door ||
                (doorway > frame.left + 12 && doorway < frame.right - 12),
              doorway,
            };
          },
          { door },
        );
        // Compare real screen pixels with the painting's texture in a clear
        // strip above this fixture's cast. Complete images can still await
        // compositor raster work; a flat stage must never pass this check.
        const clip = {
          x: Math.round(width * 0.35),
          y: 60,
          width: 70,
          height: 80,
        };
        const reference = await page.evaluate((clip) => {
          const image = document.querySelector("#backdrop");
          const style = getComputedStyle(image);
          const box = image.getBoundingClientRect();
          const scale = Math.max(
            box.width / image.naturalWidth,
            box.height / image.naturalHeight,
          );
          const [x, y] = style.objectPosition.split(" ").map(parseFloat);
          const canvas = document.createElement("canvas");
          canvas.width = clip.width;
          canvas.height = clip.height;
          const context = canvas.getContext("2d");
          context.filter = style.filter;
          context.drawImage(
            image,
            box.x + x - clip.x,
            box.y + y - clip.y,
            image.naturalWidth * scale,
            image.naturalHeight * scale,
          );
          return [...context.getImageData(0, 0, clip.width, clip.height).data];
        }, clip);
        let paintCorrelation = 0;
        const deadline = Date.now() + 5000;
        do {
          screenshot = await page.screenshot();
          const pixels = await sharp(screenshot)
            .extract({
              left: clip.x,
              top: clip.y,
              width: clip.width,
              height: clip.height,
            })
            .ensureAlpha()
            .raw()
            .toBuffer();
          let covariance = 0,
            actualVariance = 0,
            referenceVariance = 0;
          for (let row = 0; row < clip.height; row++) {
            const values = (data) =>
              Array.from({ length: clip.width }, (_, col) => {
                const i = (row * clip.width + col) * 4;
                return data[i] + data[i + 1] + data[i + 2];
              });
            const actual = values(pixels),
              expected = values(reference);
            const mean = (values) =>
              values.reduce((a, b) => a + b, 0) / values.length;
            const aMean = mean(actual),
              eMean = mean(expected);
            for (let col = 0; col < clip.width; col++) {
              const a = actual[col] - aMean,
                e = expected[col] - eMean;
              covariance += a * e;
              actualVariance += a * a;
              referenceVariance += e * e;
            }
          }
          paintCorrelation =
            covariance / Math.sqrt(actualVariance * referenceVariance);
          if (paintCorrelation > 0.6) break;
          await page.waitForTimeout(50);
        } while (Date.now() < deadline);
        assert(
          paintCorrelation > 0.6,
          `${name} ${width}: painting is visibly rendered (${paintCorrelation})`,
        );
        return { ...geometry, paintCorrelation };
      };
      let first;
      try {
        first = await inspect();
      } catch (error) {
        console.error({
          name,
          width,
          expected,
          errors,
          shown: await page.locator("#backdrop").getAttribute("src"),
          text: (await page.locator("body").innerText()).slice(0, 800),
        });
        await page.screenshot({
          path: new URL(`failed-${name}-${width}.png`, output).pathname,
        });
        throw error;
      }
      assert(
        first.fits && first.doorVisible,
        `${name} ${width}: ${JSON.stringify(first)}`,
      );
      await page.reload();
      const loaded = await inspect();
      assert(
        loaded.fits && loaded.doorVisible,
        `${name} ${width} after reload`,
      );
      assert.deepEqual(errors, []);
      await writeFile(new URL(`${name}-${width}.png`, output), screenshot);
      results.push({ name, width, expected, ...loaded, reloaded: true });
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
await writeFile(
  new URL("report.json", output),
  JSON.stringify(results, null, 2),
);
console.log(
  `Painted travel: ${results.length} desktop/phone states passed, including doorway framing and reload.`,
);
