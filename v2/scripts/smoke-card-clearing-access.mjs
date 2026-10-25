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
let fixture = enableMotives(createWorld({ opening: true }));
fixture = act(act(fixture, "light"), "move", "pond");
fixture.actors.moth.place = "attic";
fixture.items.lamp.holder = "moth";
fixture.items.bell.holder = "vale";
fixture = act(act(fixture, "ring"), "ring");
const save = encodeSave(fixture);
const key = "cosyworld.reflected-shore.v1.clearing-access-check";
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
      `http://127.0.0.1:${server.address().port}/?table=clearing-access-check`,
    );
    await card("clearing").waitFor();
    await ready();
    const use = async (id) => {
      await card(id).click();
      await card(id).click();
      await ready();
    };
    const wait = () => use("pond");
    await wait();
    await wait();
    assert.equal((await state()).items.bell.ringing, 1);
    await use("bell");
    assert.equal((await state()).items.bell.ringing, 3);
    await wait();
    await page.reload();
    await ready();
    assert.equal((await state()).items.bell.ringing, 2);
    assert.equal(await card("clearing").count(), 1);
    await wait();
    await wait();
    assert.equal(await card("clearing").count(), 0);
    assert.equal((await state()).crossings["pond-clearing"].discovered, true);
    await use("bell");
    assert.equal(await card("clearing").count(), 0);
    await use("bell");
    assert.equal(await card("clearing").count(), 1);
    // A save arriving from another tab closes a selected, now-stale route.
    await card("clearing").click();
    const expired = act(act(act(await state(), "wait"), "wait"), "wait");
    await page.evaluate(
      ({ key, value }) => {
        localStorage.setItem(key, value);
        window.dispatchEvent(
          new StorageEvent("storage", { key, newValue: value }),
        );
      },
      { key, value: encodeSave(expired) },
    );
    await ready();
    assert.equal(await card("clearing").count(), 0);
    assert.equal((await state()).actors.vale.place, "pond");
    await use("bell");
    await use("bell");
    await wait();
    await wait();
    await use("clearing");
    assert.equal((await state()).actors.vale.place, "clearing");
    assert.equal((await state()).items.bell.ringing, 0);
    await page.reload();
    await ready();
    // With every bell silent the way back is hidden; the clock's own bell
    // on the clearing card reopens it.
    assert.equal(await card("pond").count(), 0);
    await card("clearing").click();
    await page.locator('[data-choices-for="clearing"]').click();
    await page
      .getByRole("button", { name: "Ring the Steam Clock", exact: true })
      .click();
    await ready();
    assert.equal(await card("pond").count(), 1);
    await use("pond");
    assert.equal((await state()).actors.vale.place, "pond");
    assert.equal(await card("clearing").count(), 0);
    assert.ok(requests.length > 0);
    assert.deepEqual(errors, []);
    console.log(
      `Clearing expiry, refresh, reload, stale selection, clock bell and safe return passed at ${width}px.`,
    );
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
