import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { questCards, questCardId } from "../card-game/quest-cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/card-boardyai/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const seed = dispatchShared({ op: "create" }).world;
    const world = dispatchShared({
      op: "view",
      world: seed,
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    }).world;
    const quest = questCardId(world, questCards(world, "boardyai")[0]);
    const table = `boardyai-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save }) => {
        localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(world) },
    );
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "boardy-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text: "Who would you like to meet?",
          })),
        },
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await page.locator('#hand [data-card="boardyai"]').waitFor();
    await page.locator('#cast [data-avatar="boardyai"]').waitFor();
    await selectCard(page, "boardyai");
    await selectCard(page, quest);
    const card = page.locator(`#hand [data-card="${quest}"]`);
    assert.equal(await card.getAttribute("data-quest-status"), "active");
    assert.match(
      await card.textContent(),
      /Bring two human players together\./,
    );
    const portrait = page.locator('#cast [data-avatar="boardyai"] img').first();
    assert(
      await portrait.evaluate((img) => img.complete && img.naturalWidth > 0),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: new URL(`quest-${width}.png`, output).pathname,
    });
    await page.reload();
    await page.locator('#hand [data-card="boardyai"]').waitFor();
    assert.equal(await page.locator(`#hand [data-card="${quest}"]`).count(), 1);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `BoardyAI avatar, quest, art and reload passed at ${width}x${height}.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
