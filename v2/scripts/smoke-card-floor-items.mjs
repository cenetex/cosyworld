// Things lying in the current place rest on the stage as card pictures.
import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { sceneStaging } from "../card-game/scene.mjs";

const output = new URL("../../output/floor-items/", import.meta.url);
await mkdir(output, { recursive: true });

// The rules place the bell at the station from the start, and the willows camp
// holds more things than the floor shows. Boardy's calling card waits there too,
// but it shows only while BoardyAI does, with two connected humans.
const station = createWorld({ opening: true });
station.actors.vale.place = "station";
assert.deepEqual(
  sceneStaging(station, { currentState: true }).floorItems.map(({ id }) => id),
  ["bell"],
);
const camp = createWorld({ opening: true });
camp.actors.vale.place = "willows-camp";
assert.equal(sceneStaging(camp, { currentState: true }).floorItems.length, 6);

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [844, 390],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/card-game/text", async (route) => {
      const c = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          revision: c.revision,
          model: "floor-items-fixture",
          entries: c.entities.map(({ id }) => ({ id, text: "Dust settles." })),
        }),
      });
    });
    const key = `cosyworld.reflected-shore.v1.floor-items-${width}`;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(createWorld({ opening: true })) },
    );
    async function ready() {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(30);
      }
      throw Error("hand remained busy");
    }
    async function cards(...ids) {
      await ready();
      for (const id of ids)
        await selectCard(page, id, { touch: width === 390 });
      await page.locator("#card-actions .card-primary").click();
      await ready();
    }
    const floor = page.locator("#floor-items .floor-item");
    async function assertFloor(ids, shot) {
      await page.waitForFunction(
        (ids) =>
          JSON.stringify(
            [...document.querySelectorAll("#floor-items .floor-item")].map(
              (el) => el.dataset.item,
            ),
          ) === JSON.stringify(ids),
        ids,
      );
      for (const id of ids) {
        const tile = page.locator(`#floor-items [data-item="${id}"]`);
        await tile
          .locator("img")
          .first()
          .evaluate((img) => img.decode());
        const box = await tile.boundingBox();
        assert(box.width >= 30 && box.height >= 40, `${id} stays legible`);
        assert(box.x >= 0 && box.x + box.width <= width, `${id} fits`);
        assert.equal(
          await tile.evaluate((el) => getComputedStyle(el).pointerEvents),
          "none",
          "floor pictures are not tappable",
        );
        // The dialogue and hand dock stay above the floor pictures.
        assert(
          await tile.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
            return !hit?.closest(".floor-item");
          }),
          `${id} lets taps reach the scene`,
        );
      }
      await page.screenshot({
        path: new URL(`${shot}-${width}.png`, output).pathname,
      });
    }
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=floor-items-${width}`,
    );
    await page
      .locator('#hand [data-card="lamp"]')
      .waitFor({ state: "attached" });
    await ready();
    await assertFloor([], "attic-empty");
    await cards("lamp", "attic");
    await assertFloor(["lamp"], "attic-lamp-down");
    assert(
      await page.locator('#hand [data-card="lamp"]').count(),
      "the hand keeps the lamp",
    );
    await cards("vale", "lamp");
    await assertFloor([], "attic-lamp-taken");
    assert.equal(await floor.count(), 0);
    // Things that start in a place are on its floor when the player arrives.
    await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
      key,
      save: encodeSave(station),
    });
    await page.reload();
    await page
      .locator('#hand [data-card="bell"]')
      .waitFor({ state: "attached" });
    await ready();
    await assertFloor(["bell"], "station-start");
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log("floor items smoke passed");
