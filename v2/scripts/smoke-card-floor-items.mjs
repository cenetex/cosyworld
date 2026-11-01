// Things lying in the current place stand on the painted floor as props: bare
// item cutouts behind the cast, at stable spots clear of the dialogue.
import { selectCard } from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { sceneStaging } from "../card-game/scene.mjs";

const output = new URL("../../output/floor-props/", import.meta.url);
await mkdir(output, { recursive: true });

// The rules place the bell and the storybook map at the station from the
// start. Boardy's calling card waits there too, but it shows only while
// BoardyAI does, with two connected humans. Since the Swede's kit is
// scattered (#1692), the willows camp floor holds the map, pot and spoon.
const station = createWorld({ opening: true });
station.actors.vale.place = "station";
assert.deepEqual(
  sceneStaging(station, { currentState: true }).floorItems.map(({ id }) => id),
  ["bell"],
);
const willows = createWorld({ opening: true });
willows.actors.vale.place = "willows-camp";
assert.deepEqual(
  sceneStaging(willows, { currentState: true }).floorItems.map(({ id }) => id),
  ["willows-map", "willows-pot", "willows-spoon"],
);
// A crowded station floor for the browser: four camp things set down beside
// the bell.
const camp = createWorld({ opening: true });
camp.actors.vale.place = "station";
for (const id of [
  "willows-map",
  "willows-rope",
  "willows-sheet",
  "willows-pot",
])
  camp.items[id].holder = "station";
const spots = (world) =>
  JSON.stringify(sceneStaging(world, { currentState: true }).floorItems);
assert.equal(spots(camp), spots(structuredClone(camp)), "spots are stable");

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
    const layout = width >= 1300 ? "wide" : height <= 640 ? "short" : "narrow";
    async function propBoxes() {
      return page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll("#floor-items .floor-item")]
            .filter((el) => getComputedStyle(el).display !== "none")
            .map((el) => {
              const r = el.getBoundingClientRect();
              return [el.dataset.item, [r.x, r.y, r.width, r.height]];
            }),
        ),
      );
    }
    async function assertFloor(ids, shot, shown = ids) {
      await page.waitForFunction(
        (ids) =>
          JSON.stringify(
            [...document.querySelectorAll("#floor-items .floor-item")].map(
              (el) => el.dataset.item,
            ),
          ) === JSON.stringify(ids),
        ids,
      );
      for (const id of ids)
        await page
          .locator(`#floor-items [data-item="${id}"] img`)
          .first()
          .evaluate((img) => img.decode());
      const boxes = await propBoxes();
      assert.deepEqual(Object.keys(boxes), shown, "the shown props");
      const layer = await page.evaluate(() => {
        const floor = document.getElementById("floor-items");
        const cast = document.getElementById("cast");
        const dialogue = document.querySelector(".dialogue");
        return {
          sameParent: floor.parentElement === cast.parentElement,
          before: Boolean(
            floor.compareDocumentPosition(cast) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
          floorZ: Number(getComputedStyle(floor).zIndex),
          castZ: getComputedStyle(cast).zIndex,
          portraitZ: [...cast.querySelectorAll(".portrait")].map((el) =>
            Number(getComputedStyle(el).zIndex),
          ),
          portraitHeights: [...cast.querySelectorAll(".portrait")].map(
            (el) => el.getBoundingClientRect().height,
          ),
          dialogue: (() => {
            const r = dialogue.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          })(),
          props: [...floor.querySelectorAll(".floor-item")].map((el) => {
            const style = getComputedStyle(el);
            return {
              id: el.dataset.item,
              tags: [...el.children].map((child) => child.tagName),
              text: el.textContent.trim(),
              border: style.borderTopWidth,
              background: style.backgroundImage + style.backgroundColor,
              shadow: style.boxShadow,
              pointer: style.pointerEvents,
            };
          }),
        };
      });
      // Props sit behind every avatar in the stage's own stacking order.
      assert(layer.sameParent && layer.before, "props precede the cast");
      assert.equal(layer.castZ, "auto", "the cast shares the stage stacking");
      for (const z of layer.portraitZ)
        assert(layer.floorZ < z, "props stand behind the avatars");
      for (const prop of layer.props) {
        // The bare item art only: no frame, background, border or label.
        assert(
          prop.tags.length && prop.tags.every((tag) => tag === "IMG"),
          `${prop.id} is only its cutout`,
        );
        assert.equal(prop.text, "", `${prop.id} has no label`);
        assert.equal(prop.border, "0px", `${prop.id} has no border`);
        assert.equal(
          prop.background,
          "nonergba(0, 0, 0, 0)",
          `${prop.id} has no card background`,
        );
        assert.equal(prop.shadow, "none", `${prop.id} has no card shadow`);
        assert.equal(prop.pointer, "none", `${prop.id} is not tappable`);
      }
      const tallest = Math.max(...layer.portraitHeights);
      const [dx, dy, dw, dh] = layer.dialogue;
      const list = Object.entries(boxes);
      for (const [id, [x, y, w, h]] of list) {
        assert(w >= 28, `${id} stays visible`);
        assert(h < tallest * 0.3, `${id} stays hand-sized beside the cast`);
        assert(x >= 0 && x + w <= width, `${id} fits the stage`);
        assert(
          y + h <= dy + 2 ||
            y >= dy + dh - 2 ||
            x + w <= dx + 2 ||
            x >= dx + dw - 2,
          `${id} stays clear of the dialogue`,
        );
      }
      for (const [a, [ax, ay, aw, ah]] of list)
        for (const [b, [bx, by, bw, bh]] of list) {
          if (a >= b) continue;
          const overlap =
            Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) *
            Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
          assert(
            overlap < Math.min(aw * ah, bw * bh) * 0.2,
            `${a} and ${b} do not stack`,
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
    // A fresh render puts every prop back on the same spot.
    const before = await propBoxes();
    await page.reload();
    await page
      .locator('#hand [data-card="bell"]')
      .waitFor({ state: "attached" });
    await ready();
    await assertFloor(["bell"], "station-again");
    const after = await propBoxes();
    for (const [id, box] of Object.entries(before))
      box.forEach((value, index) =>
        assert(
          Math.abs(value - after[id][index]) < 1,
          `${id} keeps its spot across a render`,
        ),
      );
    // A crowded floor shows six props on a wide stage and three on a narrow one.
    await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
      key,
      save: encodeSave(camp),
    });
    await page.reload();
    await ready();
    const campIds = sceneStaging(camp, { currentState: true }).floorItems.map(
      ({ id }) => id,
    );
    await assertFloor(
      campIds,
      "camp-crowded",
      sceneStaging(camp, { currentState: true })
        .floorItems.filter(({ spots }) => spots[layout])
        .map(({ id }) => id),
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log("floor items smoke passed");
