import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import { DAYLIGHT_TURNS } from "../card-game/daylight.mjs";
import { housePrepared } from "../../test/helpers/greek-house-of-blood.mjs";

const output =
  process.env.COSYWORLD_HOUSE_ART_EVIDENCE ||
  new URL("../../output/house-of-blood-art/", import.meta.url).pathname;
const fixtures = [
  ["eumenides", "ares-hill-scene", false],
  ["orestes", "argos-refuge-scene", false],
  ["tauris", "tauris-shore-scene", false],
  ["tauris", "tauris-shore-ship-at-berth", true],
];
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const width of [1440, 390]) {
    for (const [chapter, filename, occupiedPreview] of fixtures) {
      for (const phase of ["day", "night"]) {
        const world = housePrepared(chapter);
        const cycle = DAYLIGHT_TURNS * 2;
        world.turn = world.revision =
          Math.ceil(world.turn / cycle) * cycle +
          (phase === "night" ? DAYLIGHT_TURNS : 0);
        const suffix = phase === "night" ? "-night" : "";
        const file = filename + suffix;
        const table = `bv-${chapter}-${occupiedPreview ? "ship" : "land"}-${phase}-${width}`;
        assert.ok(table.length <= 40);
        const key = `cosyworld.reflected-shore.v1.${table}`;
        const page = await browser.newPage({
          viewport: { width, height: width === 390 ? 844 : 900 },
          reducedMotion: "reduce",
        });
        const errors = [],
          failedAssets = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          if (response.status() >= 400 && response.url().includes("/assets/"))
            failedAssets.push(response.url());
        });
        try {
          await page.addInitScript(
            ({ key, save, seen }) => {
              localStorage.setItem(key, save);
              localStorage.setItem(key + ".seen", JSON.stringify(seen));
              localStorage.setItem("cosyworld.dialogue.sound", "off");
              localStorage.setItem(
                "cosyworld.room-music",
                JSON.stringify({ enabled: false }),
              );
            },
            { key, save: encodeSave(world), seen: Object.keys(profiles) },
          );
          await page.route("**/card-game/text", async (route) => {
            const input = route.request().postDataJSON();
            await route.fulfill({
              json: {
                revision: input.revision,
                model: "house-art-fixture",
                entries: input.entities.map(({ id }) => ({
                  id,
                  text:
                    input.disclosures?.find((fact) => fact.speaker === id)
                      ?.text || "I have heard the account.",
                })),
              },
            });
          });
          await page.goto(`${origin}/?table=${table}`);
          await page.waitForSelector("#hand .card");
          for (let i = 0; i < 250; i++) {
            if (await page.locator("#unveil-dialog[open]").count())
              await page.keyboard.press("Escape");
            else if (await page.locator("#dialogue-advance").isVisible())
              await page.locator("#dialogue-advance").click();
            if (
              (await page.locator("#hand").getAttribute("data-cooling")) ===
              "false"
            )
              break;
            await page.waitForTimeout(40);
          }
          await page.waitForFunction(
            ({ phase, savedFile }) => {
              const image = document.querySelector("#backdrop");
              return (
                document.querySelector("#stage").dataset.timeOfDay === phase &&
                image.complete &&
                image.naturalWidth > 0 &&
                new URL(image.currentSrc).pathname.endsWith(
                  `/house-of-blood/${savedFile}.webp`,
                )
              );
            },
            {
              phase,
              savedFile: occupiedPreview ? "tauris-shore-scene" + suffix : file,
            },
          );
          assert.equal(
            await page.locator("#stage").getAttribute("data-time-of-day"),
            phase,
          );
          if (occupiedPreview) {
            // Preview the crossing's future painting through the real light and
            // image helpers. The combined ship tests own saved dock selection.
            await page.evaluate(
              async ({ turn }) => {
                const { daylightBackdrop } = await import("./daylight.mjs");
                const { imageUrl } = await import("./images.mjs");
                const source = daylightBackdrop(
                  { turn },
                  "greek-tauris-shore",
                  "assets/greek-drama/house-of-blood/tauris-shore-ship-at-berth.png",
                );
                document.querySelector("#backdrop").src = imageUrl(
                  "./" + source,
                );
              },
              { turn: world.turn },
            );
          }
          await page.waitForFunction((file) => {
            const image = document.querySelector("#backdrop");
            return (
              image.complete &&
              image.naturalWidth > 0 &&
              new URL(image.currentSrc).pathname.endsWith(
                `/house-of-blood/${file}.webp`,
              )
            );
          }, file);
          await page.waitForFunction(() =>
            [...document.querySelectorAll("#cast img")].every(
              (image) => image.complete && image.naturalWidth > 0,
            ),
          );
          await page.evaluate(async () => {
            await Promise.all(
              [...document.querySelectorAll("#backdrop, #cast img")].map(
                (image) => image.decode(),
              ),
            );
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          assert.deepEqual(errors, []);
          assert.deepEqual(failedAssets, []);
          await page.screenshot({
            path: `${output}/${file}-${width}.png`,
            fullPage: true,
          });
          results.push({
            file,
            width,
            phase,
            mode: occupiedPreview ? "occupied-art-preview" : "saved-game-scene",
            errors,
            failedAssets,
          });
          console.log(
            `${file}, ${width}px: ${occupiedPreview ? "occupied art preview" : "saved scene"} passed`,
          );
        } finally {
          await page.close();
        }
      }
    }
  }
  await writeFile(
    `${output}/results.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
