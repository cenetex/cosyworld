// Things lying in the current place stand on the painted floor as props: bare
// item cutouts behind the cast, at stable spots clear of the dialogue.
import {
  clearSelection,
  readyActionButton,
  revealOpening,
  selectCard,
  unreachableCards,
} from "./card-browser-helpers.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { sceneStaging } from "../card-game/scene.mjs";

const output = new URL("../../output/floor-props/", import.meta.url);
await mkdir(output, { recursive: true });

const station = createWorld({ opening: true, seed: 7 });
station.actors.vale.place = "station";
const stationProps = ["bell", "keeper-log", "ratiradio-red-beanie"];
assert.deepEqual(
  sceneStaging(station, { currentState: true }).floorItems.map(({ id }) => id),
  stationProps,
);
const willows = createWorld({ opening: true, seed: 7 });
willows.actors.vale.place = "willows-camp";
assert.equal(willows.items["willows-notebook"].holder, "willows-camp");
assert.deepEqual(
  sceneStaging(willows, { currentState: true }).floorItems.map(({ id }) => id),
  [],
);
willows.packs.willows.flags["willows-willows-paced"] = true;
assert.deepEqual(
  sceneStaging(willows, { currentState: true }).floorItems.map(({ id }) => id),
  ["willows-notebook"],
);
const camp = structuredClone(station);
const lead = "elysium-wayfinder";
const known = [
  "bell",
  "willows-map",
  "willows-rope",
  "willows-sheet",
  "willows-notebook",
  "ratiradio-station-key",
  lead,
];
const covered = ["keeper-log", "willows-paddle", "cloth", "ratiradio-red-beanie"];
for (const id of [...known, ...covered]) camp.items[id].holder = "station";
camp.items.cloth.holder = "bell";
camp.actors.vale.want = { kind: "item", target: lead, since: 0, refusals: 0 };
const spots = (world) =>
  JSON.stringify(sceneStaging(world, { currentState: true }).floorItems);
assert.equal(spots(camp), spots(structuredClone(camp)), "spots are stable");
const lockedPond = createWorld({ seed: 17 });
lockedPond.actors.vale.place = "pond";
lockedPond.actors.vale.visited.push("pond");
lockedPond.items["ratiradio-station-key"].holder = "station";

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
      { key, save: encodeSave(createWorld({ opening: true, seed: 7 })) },
    );
    async function ready() {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await page.locator("#dialogue-advance").isVisible())
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
      await clearSelection(page);
      for (const id of ids)
        await selectCard(page, id, { touch: width === 390 });
      await readyActionButton(page).click();
      await ready();
    }
    const floor = page.locator("#floor-items .floor-item");
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
      ).catch(async (error) => {
        const actual = await floor.evaluateAll((items) => items.map((el) => el.dataset.item));
        const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
        throw new Error(`${shot}: expected ${ids}, got ${actual}; place=${state.actors.vale.place}; lamp=${JSON.stringify(state.items.lamp)}; ${error.message}`);
      });
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
    await revealOpening(page);
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
    await assertFloor(stationProps, "station-start");
    // A fresh render puts every prop back on the same spot.
    const before = await propBoxes();
    await page.reload();
    await page
      .locator('#hand [data-card="bell"]')
      .waitFor({ state: "attached" });
    await ready();
    await assertFloor(stationProps, "station-again");
    const after = await propBoxes();
    for (const [id, box] of Object.entries(before))
      box.forEach((value, index) =>
        assert(
          Math.abs(value - after[id][index]) < 1,
          `${id} keeps its spot across a render`,
        ),
      );
    // Covered objects leave their floor slots for known objects farther down the list.
    await page.evaluate(
      ({ key, save, covered }) => {
        localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen.covered`, JSON.stringify(covered));
      },
      { key, save: encodeSave(camp), covered },
    );
    await page.reload();
    await ready();
    await floor.first().waitFor();
    const campIds = await floor.evaluateAll((props) =>
      props.map((el) => el.dataset.item),
    );
    const shown = Object.keys(await propBoxes());
    assert.equal(
      shown.length,
      width >= 1300 ? 6 : 3,
      "known objects fill the available spots",
    );
    assert.equal(
      shown[0],
      lead,
      "the current item quest leads the visible props",
    );
    assert(
      campIds.every((id) => known.includes(id)),
      "covered items stay off the floor",
    );
    assert.equal(
      await page.locator("#floor-items .object-cover").count(),
      0,
      "the Bell's covered cloth stays off the floor",
    );
    const bell = page.locator('#floor-items [data-item="bell"]');
    assert.equal(await bell.getAttribute("data-covered"), "true");
    await assertFloor(campIds, "camp-crowded", shown);
    const stationPreview = page.locator(
      '.card-frame:has(> [data-card="station"]) > .held-preview',
    );
    const leadArt = page.locator(`#hand [data-card="${lead}"] .art img`);
    assert.equal(
      await stationPreview.getAttribute("src"),
      await leadArt.getAttribute("src"),
    );
    await selectCard(page, "station", { touch: width === 390 });
    const room = page.locator(
      '#hand > [data-holder="station"]:not([hidden]) > .card',
    );
    const fanned = await room.evaluateAll((cards) =>
      cards.map((card) => card.dataset.card),
    );
    assert.equal(fanned[0], lead, "the current item quest leads the room fan");
    assert(
      known.every((id) => fanned.includes(id)),
      "all known items stay in the room fan",
    );
    assert.deepEqual(
      (await unreachableCards(page)).filter((id) => known.includes(id)),
      [],
    );
    await page.evaluate(
      ({ key, save }) => {
        localStorage.setItem(key, save);
        localStorage.removeItem(`${key}.seen.covered`);
      },
      { key, save: encodeSave(lockedPond) },
    );
    await page.reload();
    await ready();
    const locks = page.getByRole("button", {
      name: "2 locked boxes. Select to fan out.",
    });
    await locks.waitFor();
    const pondPreview = page.locator(
      '.card-frame:has(> [data-card="pond"]) > .held-preview',
    );
    assert.equal(
      await pondPreview.count(),
      0,
      "the dedicated lock stack owns its only preview",
    );
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log("floor items smoke passed");
