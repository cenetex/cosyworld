import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../card-game/narrative.mjs";

let world = enableMotives(createWorld());
world.actors.keeper.place = "station";
world.items.lamp.holder = "vale";
world.items.bell.holder = "keeper";
world = play(
  world,
  legalActions(world).find((a) => a.kind === "ask" && a.item === "oil"),
).state;
const context = narrativeContext(world);
world = applyGeneratedText(world, context, {
  revision: context.revision,
  model: "fixture-model",
  entries: context.entities.map(({ id }) => ({
    id,
    text: "The shore feels quiet.",
    ...(id === "vale"
      ? {
          reflection: {
            thought: "I expected an easy gift. A fair offer may help.",
            persona: "I am learning to listen before asking again.",
            dream: "A little boat carried a gift across the pond.",
          },
        }
      : {}),
  })),
});
world.memories.keeper.innerLife = {
  persona: "Keeper private sentinel.",
  thoughts: [],
  dreams: [],
};
const output =
  process.env.COSYWORLD_LEARNING_SCREENSHOTS || resolve("output/card-learning");
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (save) =>
        localStorage.setItem("cosyworld.reflected-shore.v1.learning", save),
      encodeSave(world),
    );
    await page.route("**/card-game/text", async (route) => {
      const scene = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          revision: scene.revision,
          model: "fixture-model",
          entries: scene.entities.map((e) => ({
            id: e.id,
            text: "I can listen for a moment.",
          })),
        }),
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=learning`,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page
        .getByRole("button", { name: "Inner life", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "Vale's inner life" });
      await dialog.waitFor();
      const text = await dialog.innerText();
      assert(text.includes("learning to listen"));
      assert(text.includes("My goal is still open"));
      assert(text.includes("1 measured attempt"));
      assert(text.includes("little boat"));
      assert(!text.includes("Keeper private sentinel"));
      const box = await dialog.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width + 1);
      if (!attempt)
        await page.screenshot({
          path: `${output}/inner-life-${width}.png`,
          fullPage: true,
        });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      if (!attempt) await page.reload();
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Avatar learning browser check passed at desktop and phone widths, including reload and private-panel checks.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
