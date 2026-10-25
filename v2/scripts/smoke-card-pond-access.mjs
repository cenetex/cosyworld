import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  const result = play(s, action);
  assert.ok(result.ok);
  return result.state;
};
let fixture = enableMotives(createWorld({ opening: true }), {
  questPrograms: true,
});
fixture = act(act(fixture, "light"), "move", "pond");
fixture.items.lamp.holder = "moth";
fixture.items.lamp.fuel = 8;
fixture = act(fixture, "wait");
const save = encodeSave(fixture);
const key = "cosyworld.reflected-shore.v1.pond-access-check";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [],
      requests = [];
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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: input.revision,
          model: "browser-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: `${id} fixture text.`,
          })),
        }),
      });
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
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=pond-access-check`,
    );
    await card("attic").waitFor({ state: "attached" });
    await ready();
    assert.equal(
      await card("attic").locator(".name").innerText(),
      "Mirror attic",
    );
    await selectCard(page, "pond");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    const departed = await state();
    assert.equal(departed.actors.moth.place, "station");
    assert.equal(departed.items.lamp.holder, "moth");
    assert.equal(departed.items.lamp.lit, true);
    assert.equal(await card("attic").count(), 0);
    assert.equal(await card("pond").locator(".name").innerText(), "Black pond");
    assert.equal(requests.length, 0);
    assert.deepEqual(
      departed.log
        .filter(
          (e) =>
            e.turn === departed.turn && e.generated && e.kind === "dialogue",
        )
        .map((e) => e.actorId),
      [],
    );
    await page.reload();
    await ready();
    assert.equal(await card("attic").count(), 0);
    // A save arriving from another tab also rebuilds availability and selection.
    departed.items.lamp.holder = "vale";
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(departed) },
    );
    await card("attic").waitFor({ state: "attached" });
    await ready();
    await selectCard(page, "attic");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal((await state()).actors.vale.place, "attic");
    assert.equal(
      await card("attic").locator(".name").innerText(),
      "Mirror attic",
    );
    await selectCard(page, "lamp");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal((await state()).items.lamp.lit, false);
    assert.equal(await card("pond").count(), 0);
    await page.reload();
    await ready();
    assert.equal(await card("pond").count(), 0);
    assert.equal((await state()).actors.vale.place, "attic");
    await selectCard(page, "lamp");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    await selectCard(page, "pond");
    await page.locator("#card-actions .card-primary").click();
    await ready();
    assert.equal((await state()).actors.vale.place, "pond");
    assert.deepEqual(errors, []);
    console.log(
      `Mirror access in both directions, quiet departure, reload and relighting passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
