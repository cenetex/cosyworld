import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { openingFixture } from "../../test/helpers/greek-opening.mjs";
import { DAYLIGHT_TURNS } from "../card-game/daylight.mjs";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave, legalActions, play } from "../card-game/world.mjs";

const output = new URL("../../output/gate-backdrop/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const results = [];
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
  const base = openingFixture("burial").decree;
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const open of [false, true]) {
      for (const night of [false, true]) {
        const name = `${open ? "open" : "closed"}-${night ? "night" : "day"}`;
        let world = structuredClone(base);
        while (Math.floor(world.turn / DAYLIGHT_TURNS) % 2 !== Number(night)) {
          const action = legalActions(world).find((a) => a.kind === "wait");
          assert(action, "waiting can advance the saved clock");
          const next = play(world, action);
          assert(next.ok, next.error);
          world = next.state;
        }
        world.actors.vale.place = "greek-gate";
        world.actors["greek-guard"].place = "greek-gate";
        world.items["greek-decree"].holder = open
          ? "greek-guard"
          : "greek-palace";
        const table = `gate-backdrop-${width}-${name}`;
        const key = `cosyworld.reflected-shore.v1.${table}`;
        const expected = `city-gate-${open ? "" : "closed-"}${night ? "night" : "day"}.webp`;
        const page = await browser.newPage({
          viewport: { width, height },
          reducedMotion: "reduce",
        });
        const errors = [],
          missing = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
          if (response.status() >= 400 && response.url().includes("/assets/"))
            missing.push(response.url());
        });
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
          `http://127.0.0.1:${server.address().port}/?table=${table}`,
        );
        async function check() {
          await page.waitForFunction((file) => {
            const image = document.querySelector("#backdrop");
            return (
              image?.complete &&
              image.naturalWidth > 0 &&
              new URL(image.src).pathname.endsWith(file)
            );
          }, expected);
          await page.evaluate(async () => {
            await Promise.all(
              [...document.querySelectorAll("#backdrop,#cast img,#hand img")]
                .filter((image) => image.complete && image.naturalWidth)
                .map((image) => image.decode()),
            );
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          });
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            "no horizontal overflow",
          );
          assert.deepEqual(errors, []);
          assert.deepEqual(missing, []);
        }
        await check();
        await page.reload();
        await check();
        await page.screenshot({
          path: new URL(`${name}-${width}.png`, output).pathname,
        });
        results.push({ width, height, name, expected, reloaded: true });
        await page.close();
      }
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
  `Gate backdrops: ${results.length} desktop/phone states passed, including reload.`,
);
