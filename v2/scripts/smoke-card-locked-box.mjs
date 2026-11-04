// A card locked behind a quest is a carved wooden box (locked-box.mjs). At
// the shut City Gate the battlefield is the locked lid, labelled "Locked" on
// a red edge; its play gives the quest through the context button. Giving
// the guard the Burial Decree opens the way: the box turns over once and
// stays open through redraws.
//
//   node v2/scripts/smoke-card-locked-box.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { profiles } from "../card-game/memory.mjs";
import {
  revealCard,
  selectCard,
  smokeWidths,
} from "./card-browser-helpers.mjs";

const FIELD = "greek-battlefield";
const output = new URL(
  process.argv[2]
    ? `file://${process.argv[2].replace(/\/?$/u, "/")}`
    : "../../output/locked-box/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const world = enableMotives(createWorld());
world.actors.vale.place = "greek-gate";
world.crossings["pond-greek-harbor"].discovered = true;
for (const id of ["lamp", "cloth"]) world.items[id].holder = "pond";
world.items["greek-decree"].holder = "vale";
const save = encodeSave(world);
// Holds the lifting lid mid-turn for its picture.
const holdLid = ({ id, at }) =>
  new Promise((resolve) => {
    const watch = new MutationObserver(() => {
      const card = document.querySelector(`#hand [data-card="${id}"]`);
      if (!card?.dataset.revealing) return;
      watch.disconnect();
      globalThis.lid = card
        .getAnimations({ subtree: true })
        .filter((motion) => motion.effect.target.matches(".reveal-lid"));
      for (const motion of globalThis.lid) {
        motion.pause();
        motion.currentTime = at;
      }
      resolve();
    });
    watch.observe(document.getElementById("hand"), {
      subtree: true,
      attributeFilter: ["data-revealing"],
    });
  });

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of smokeWidths([1440, 390]))
    for (const reduced of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        reducedMotion: reduced ? "reduce" : "no-preference",
      });
      const key = `cosyworld.reflected-shore.v1.locked-box-${width}-${reduced}`;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(
        ({ key, save, seen }) => {
          if (!localStorage.getItem(key)) localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        },
        { key, save, seen: Object.keys(profiles) },
      );
      const field = page.locator(`#hand [data-card="${FIELD}"]`);
      const attr = (name) => field.getAttribute(name);
      const ready = () =>
        page.waitForFunction(
          () => {
            const next = document.getElementById("dialogue-advance");
            if (next?.checkVisibility()) next.click();
            return document.getElementById("hand").dataset.cooling === "false";
          },
          null,
          { polling: 40 },
        );
      const shot = async (name, wait = 900) => {
        if (reduced) return;
        await page.waitForTimeout(wait);
        await page.screenshot({
          path: new URL(`${name}-${width}.png`, output).pathname,
        });
      };
      const boxed = async () => {
        await revealCard(page, FIELD);
        assert.equal(await attr("data-locked"), "true");
        // Its only words are "Locked", on a red edge.
        assert.equal(await field.locator(".name").textContent(), "Locked");
        assert.ok(await field.locator(".name").isVisible());
        assert.equal(
          await field.evaluate((el) => getComputedStyle(el).borderTopColor),
          "rgb(226, 72, 58)",
        );
        assert.ok(await field.locator(".card-back").isVisible());
        assert.ok(!(await field.locator(".art img").first().isVisible()));
        assert.doesNotMatch(await attr("aria-label"), /Battlefield/u);
      };
      const open = async () => {
        await revealCard(page, FIELD);
        await page.waitForFunction(
          (id) =>
            !document.querySelector(`[data-card="${id}"]`).dataset.revealing,
          FIELD,
        );
        assert.equal(await attr("data-locked"), "false");
        assert.match(await field.locator(".name").textContent(), /Battle/u);
        assert.ok(!(await field.locator(".card-back").isVisible()));
      };

      const at = `http://127.0.0.1:${server.address().port}`;
      await page.goto(`${at}/?table=locked-box-${width}-${reduced}`);
      await ready();
      await boxed();
      await shot("01-locked-box");
      // Tapping the box chooses it; the context button gives its quest.
      await selectCard(page, FIELD);
      const seek = page.locator("#card-actions .card-primary");
      assert.equal(await seek.textContent(), "Seek the way");
      await seek.click();
      await ready();
      const state = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
      assert.equal((await state()).actors.vale.want.target, "greek-decree");
      await page.keyboard.press("Escape");
      await boxed();

      // The decree to the guard opens the way; the box turns over once.
      await page.keyboard.press("Escape");
      await selectCard(page, "greek-decree");
      await selectCard(page, "greek-guard");
      await page.locator("#card-actions .card-primary").click();
      await ready();
      const route = "greek-gate>greek-battlefield";
      assert.ok((await state()).openedRoutes.includes(route));
      await page.keyboard.press("Escape");
      const turning = page.evaluate(holdLid, { id: FIELD, at: 60 });
      await revealCard(page, FIELD);
      await turning;
      await shot("02-box-turning", 1200);
      await page.evaluate(() => globalThis.lid.forEach((m) => m.play()));
      await open();
      await shot("03-box-open");
      // Redraws and a reload keep it open and never turn it again.
      await selectCard(page, "greek-guard");
      await page.keyboard.press("Escape");
      await open();
      assert.equal(await attr("data-revealing"), null);
      await page.reload();
      await ready();
      await open();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`Locked box: ${width}px, reduced motion ${reduced}, passed.`);
    }
} finally {
  await browser?.close();
  server.close();
}
