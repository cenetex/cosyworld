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
      // Slow words: the request stays open until a later play replaces it.
      if (mode === "hang") return;
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
    // Loading a quiet scene is silent. Explicit conversation requests words.
    const person = page.locator('#hand [data-card="moth"]');
    await person.click();
    await page.locator("#card-actions .card-primary").click();
    await page.waitForFunction(
      () => !document.querySelector("#story-retry").hidden,
    );
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
      null,
      { timeout: 6000 },
    );
    assert.equal(requests.length, 2);
    assert.equal(await page.locator(".dialogue").isVisible(), true);
    assert.equal(await retry.isVisible(), true);
    assert.equal(await page.locator("#story-status").isVisible(), false);
    assert.equal(await retry.innerText(), "↻");
    assert.equal(await retry.getAttribute("aria-label"), "Retry dialogue");
    const retryBounds = await retry.boundingBox();
    assert(retryBounds.width <= 32 && retryBounds.height <= 32);
    assert.doesNotMatch(
      await page.locator(".dialogue").innerText(),
      /503|Retry this scene/,
    );
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
    assert.match(
      await page.textContent("#dialogue-text"),
      new RegExp(`speaks on turn ${before.turn}`),
    );
    // Invalid JSON content must fail visibly too, and a later play can recover.
    mode = "invalid";
    const pond = person;
    if ((await pond.getAttribute("aria-pressed")) !== "true")
      await pond.click();
    await page.locator("#card-actions .card-primary").click();
    await page.waitForFunction(
      () => !document.querySelector("#story-retry").hidden,
    );
    assert.equal(await page.locator("#story-status").isVisible(), false);
    assert.doesNotMatch(
      await page.locator(".dialogue").innerText(),
      /incomplete|Retry this scene/,
    );
    const failed = await state();
    assert.equal(failed.turn, before.turn + 1);
    assert.equal(
      failed.log.some((e) => e.turn === failed.turn && e.generated),
      false,
    );
    // Keep the existing history, without an extra status banner over the cast.
    assert.equal(await page.locator("#turn-receipt").count(), 0);
    assert.equal(
      failed.log.some((e) => e.turn === failed.turn && e.kind === "action"),
      true,
    );
    assert.doesNotMatch(await page.locator("#messages").innerText(), /Turn \d/);
    // Slow words release the hand rather than holding it.
    mode = "hang";
    if ((await pond.getAttribute("aria-pressed")) !== "true")
      await pond.click();
    await page.locator("#card-actions .card-primary").click();
    await page.waitForFunction(
      () => document.querySelector("#hand").dataset.cooling === "false",
      null,
      { timeout: 6000 },
    );
    assert.equal((await state()).turn, before.turn + 2);
    assert.equal(
      (await state()).log.some(
        (e) => e.turn === before.turn + 2 && e.kind === "action",
      ),
      true,
    );
    mode = "ready";
    if ((await pond.getAttribute("aria-pressed")) !== "true")
      await pond.click();
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal((await state()).turn, before.turn + 3);
    assert.match(
      await page.textContent("#dialogue-text"),
      new RegExp(`speaks on turn ${before.turn + 3}`),
    );
    await page.reload();
    await ready();
    assert.match(
      await page.textContent("#dialogue-text"),
      new RegExp(`speaks on turn ${before.turn + 3}`),
    );
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
