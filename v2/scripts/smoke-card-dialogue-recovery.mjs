import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

let fixture = enableMotives(createWorld({ opening: true }), {
  questPrograms: true,
});
for (const kind of ["light", "move"])
  fixture = play(
    fixture,
    legalActions(fixture).find(
      (a) => a.kind === kind && (kind !== "move" || a.target === "pond"),
    ),
  ).state;
const save = encodeSave(fixture),
  key = "cosyworld.reflected-shore.v1.dialogue-recovery";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await mkdir("output/dialogue-recovery", { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [],
      requests = [];
    let mode = "unavailable";
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(
          `${key}.seen`,
          JSON.stringify([
            "vale",
            "moth",
            "keeper",
            "badger",
            "lamp",
            "oil",
            "cloth",
            "bell",
            "attic",
            "pond",
            "station",
            "clearing",
          ]),
        );
      },
      { key, save },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      await route.fulfill(
        mode === "unavailable"
          ? {
              status: 503,
              contentType: "application/json",
              body: '{"error":"fixture unavailable"}',
            }
          : {
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                revision: input.revision,
                model: "browser-fixture",
                entries: input.entities
                  .slice(mode === "invalid" ? 1 : 0)
                  .map(({ id }) => ({
                    id,
                    text: `${id} speaks on turn ${input.turn}.`,
                  })),
              }),
            },
      );
    });
    const ready = async () => {
      for (let i = 0; i < 250; i++) {
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        await page.waitForTimeout(40);
      }
      throw new Error("The hand stayed busy.");
    };
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const retry = page.locator("#story-retry");
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=dialogue-recovery`,
    );
    await page.waitForFunction(() =>
      document
        .querySelector("#story-status")
        .textContent.includes("Retry this scene"),
    );
    assert.equal(requests.length, 2);
    assert.equal(await page.locator(".dialogue").isVisible(), true);
    assert.equal(await retry.isVisible(), true);
    assert.match(await page.textContent("#story-status"), /503/);
    assert.equal(
      await page.locator("#hand").getAttribute("data-cooling"),
      "false",
    );
    await page.screenshot({
      path: `output/dialogue-recovery/error-${width}.png`,
    });
    const before = await state();
    mode = "ready";
    await retry.click();
    await ready();
    const recovered = await state();
    assert.equal(requests.length, 3);
    assert.equal(recovered.turn, before.turn);
    assert.equal(recovered.revision, before.revision);
    assert.deepEqual(recovered.items, before.items);
    assert.deepEqual(recovered.actors, before.actors);
    assert.equal(await retry.isVisible(), false);
    assert.match(await page.textContent("#dialogue-text"), /speaks on turn 2/);
    // Invalid JSON content must fail visibly too, and a later play can recover.
    mode = "invalid";
    const pond = page.locator('#hand [data-card="pond"]');
    await pond.click();
    await pond.click();
    await page.waitForFunction(
      () => !document.querySelector("#story-retry").hidden,
    );
    assert.match(await page.textContent("#story-status"), /incomplete/);
    const failed = await state();
    assert.equal(failed.turn, before.turn + 1);
    assert.equal(
      failed.log.some((e) => e.turn === failed.turn && e.generated),
      false,
    );
    mode = "ready";
    await pond.click();
    await pond.click();
    await ready();
    assert.equal((await state()).turn, before.turn + 2);
    assert.match(await page.textContent("#dialogue-text"), /speaks on turn 4/);
    await page.reload();
    await ready();
    assert.match(await page.textContent("#dialogue-text"), /speaks on turn 4/);
    assert.deepEqual(errors, []);
    console.log(
      `Visible failure, same-turn retry, later play and reload passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
