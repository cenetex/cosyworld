// Holding the Oil flask with the empty Lamp fills the lamp at once, and the
// flask then waits full on the station floor (#1526).
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const output = new URL("../../output/oil-return/", import.meta.url);
await mkdir(output, { recursive: true });
const start = createWorld();
start.actors.vale.place = "pond";
start.items.lamp.holder = "vale";
start.items.lamp.fuel = 0;
start.items.lamp.lit = false;
start.items.oil.holder = "pond";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const touch = width === 390;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: touch,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "oil-return-fixture",
          entries: c.entities.map(({ id }) => ({ id, text: "The flame steadies." })),
        }),
      });
    });
    const key = `cosyworld.reflected-shore.v1.oil-return-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(start) },
    );
    async function ready() {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if ((await page.locator("#hand").getAttribute("data-cooling")) === "false")
          return;
        await page.waitForTimeout(30);
      }
      throw Error("hand remained busy");
    }
    async function cards(...ids) {
      await ready();
      for (const id of ids) await selectCard(page, id, { touch });
      await page.locator("#card-actions .card-primary").click();
      await ready();
    }
    const saved = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const floor = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#floor-items .floor-item")].map(
          (el) => el.dataset.item,
        ),
      );
    await page.goto(`http://127.0.0.1:${server.address().port}/?table=oil-return-${width}`);
    await ready();
    assert((await floor()).includes("oil"), "the flask rests on the pond floor");
    // Taking the flask puts it in the hand that holds the empty lamp.
    await cards("oil");
    await page.waitForFunction(
      (key) => JSON.parse(localStorage.getItem(key)).items.lamp.fuel === 12,
      key,
    );
    const world = await saved();
    assert.equal(world.items.oil.holder, "station");
    assert.equal(world.items.oil.doses, undefined);
    const refuel = world.log.find((e) => e.verb === "refuel");
    assert.deepEqual(
      {
        actorId: refuel.actorId,
        itemIds: refuel.itemIds,
        locationId: refuel.locationId,
        returnLocationId: refuel.returnLocationId,
      },
      {
        actorId: "vale",
        itemIds: ["oil", "lamp"],
        locationId: "pond",
        returnLocationId: "station",
      },
    );
    assert(!(await floor()).includes("oil"), "the flask leaves the pond");
    await page.screenshot({ path: new URL(`pond-${width}.png`, output).pathname });
    // The full flask waits on the station floor.
    await cards("station");
    await page.waitForFunction(() =>
      document.querySelector("#backdrop").src.includes("station"),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#floor-items .floor-item")].some(
        (el) => el.dataset.item === "oil",
      ),
    );
    await page.screenshot({ path: new URL(`station-${width}.png`, output).pathname });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "Oil return browser check passed at desktop and phone widths: the empty lamp filled and the flask waits at the station.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
