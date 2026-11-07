// A card locked behind a quest is a carved wooden box (locked-box.mjs). At
// the shut City Gate the battlefield is the locked lid, labelled "Locked" on
// a red edge; its contents stay concealed. Talk gives the guard's quest. Giving
// the guard Creon's Writ opens the way: the box turns over once and
// stays open through redraws.
//
//   node v2/scripts/smoke-card-locked-box.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { encodeSave } from "../card-game/world.mjs";
import { openingFixture } from "../../test/helpers/greek-opening.mjs";
import { profiles } from "../card-game/memory.mjs";
import {
  readyActionButton,
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
const world = structuredClone(openingFixture("burial").decree);
world.actors.vale.place = "greek-gate";
world.crossings["pond-greek-harbor"].discovered = true;
for (const id of ["lamp", "cloth"]) world.items[id].holder = "pond";
world.items["greek-creon-writ"].holder = "vale";
const save = encodeSave(world);
// Holds the lifting lid mid-turn for its picture.
const holdLid = ({ id, at, reduced }) =>
  new Promise((resolve, reject) => {
    const watch = new MutationObserver(() => {
      const card = document.querySelector(`#hand [data-card="${id}"]`);
      if (!card?.dataset.revealing) return;
      globalThis.lid = card
        .getAnimations({ subtree: true })
        .filter((motion) => motion.effect.target.matches(".reveal-lid"));
      if (!reduced && !globalThis.lid.length) return;
      watch.disconnect();
      clearTimeout(deadline);
      for (const motion of globalThis.lid) {
        motion.pause();
        motion.currentTime = at;
      }
      resolve();
    });
    const deadline = setTimeout(() => {
      watch.disconnect();
      reject(new Error("The locked lid did not turn"));
    }, 15000);
    watch.observe(document.getElementById("hand"), {
      subtree: true,
      childList: true,
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
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, save);
            localStorage.setItem(`${key}.seen.covered`, JSON.stringify(["greek-creon-writ"]));
          }
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        },
        { key, save, seen: Object.keys(profiles).filter((id) => id !== "greek-creon-writ") },
      );
      await page.route("**/card-game/text", (route) => {
        const context = route.request().postDataJSON();
        return route.fulfill({
          json: {
            revision: context.revision,
            model: "locked-box-fixture",
            entries: context.entities.map(({ id }) => ({
              id,
              text:
                context.disclosures?.find((fact) => fact.speaker === id)
                  ?.text || "Let us consider this.",
            })),
          },
        });
      });
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
        // Every closed box has the same nameless lid.
        assert.equal(await field.locator(".name").textContent(), "");
        assert.equal(
          await field.evaluate((el) => getComputedStyle(el).borderTopColor),
          "rgb(226, 72, 58)",
        );
        assert.ok(await field.locator(".card-back").isVisible());
        assert.ok(!(await field.locator(".art img").first().isVisible()));
        assert.equal(await attr("aria-label"), "Closed box");
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
      const lidState = (card) => card.evaluate((el) => ({
        src: el.querySelector(".card-back").src,
        name: el.querySelector(".name").textContent,
        label: el.getAttribute("aria-label"),
        border: getComputedStyle(el).borderTopColor,
        outline: getComputedStyle(el.querySelector(".card-back")).outline,
        width: getComputedStyle(el).width,
        height: getComputedStyle(el).height,
      }));
      const closedLid = await lidState(field);
      await page.keyboard.press("Escape");
      await selectCard(page, "vale");
      const writ = page.locator('#hand [data-card="greek-creon-writ"]');
      assert.equal(await writ.getAttribute("data-unrevealed"), "true");
      assert.deepEqual(await lidState(writ), closedLid);
      await revealCard(page, "greek-creon-writ");
      assert.equal(await writ.getAttribute("data-locked"), "false");
      assert.match(await writ.getAttribute("aria-label"), /Creon/u);
      await page.keyboard.press("Escape");
      // Selecting the box keeps its contents concealed. Talk gives the guard's quest.
      await selectCard(page, FIELD);
      const lock = page.locator('#card-actions [data-blocked="gate"]');
      assert.equal(await lock.textContent(), "Locked");
      assert.equal(
        await page.locator(".action-beat-text").textContent(),
        "A closed box.",
      );
      assert.equal(await lock.isDisabled(), true);
      assert.equal(await lock.getAttribute("title"), "A closed box.");
      assert.equal(await page.locator("#selection-name").textContent(), "Closed box");
      assert.doesNotMatch(await page.locator("#play-readout").textContent(), /Battlefield|Guard|Writ/u);
      await page.keyboard.press("Escape");
      await selectCard(page, "greek-guard");
      if (await page.locator('#card-actions [data-action="meet"]').count()) {
        await readyActionButton(page, "meet").click();
        await ready();
        await page.keyboard.press("Escape");
        await selectCard(page, "greek-guard");
      }
      await page.evaluate(() => {
        const watch = new MutationObserver(() => {
          const card = document.querySelector('.want-card[data-unrevealed="true"][aria-label="Closed box"]');
          if (!card) return;
          const back = card.querySelector(".card-back");
          window.closedQuestEvidence = { src: back.src, label: card.getAttribute("aria-label"),
            border: getComputedStyle(card).borderTopColor, outline: getComputedStyle(back).outline,
            near: card.dataset.near, art: getComputedStyle(card.querySelector(".quest-screen")).visibility };
          watch.disconnect();
        });
        watch.observe(document.getElementById("hand"), { subtree: true, childList: true, attributes: true });
      });
      await readyActionButton(page, "talk").click();
      await ready();
      const state = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
      assert.equal((await state()).actors.vale.want.target, "greek-bread");
      const questLid = await page.evaluate(() => window.closedQuestEvidence);
      assert(questLid, "the new quest first uses the closed-box state");
      assert.deepEqual(questLid, { src: closedLid.src, label: closedLid.label,
        border: closedLid.border, outline: closedLid.outline, near: "false", art: "hidden" });
      await page.keyboard.press("Escape");
      await boxed();

      // The writ to the guard opens the way; the box turns over once.
      await page.keyboard.press("Escape");
      await selectCard(page, "greek-creon-writ");
      await selectCard(page, "greek-guard");
      const turning = page.evaluate(holdLid, { id: FIELD, at: 60, reduced });
      await readyActionButton(page).click();
      assert.equal(
        (await state()).items["greek-creon-writ"].holder,
        "greek-guard",
      );
      await page.keyboard.press("Escape");
      const revealing = revealCard(page, FIELD);
      await turning;
      await shot("02-box-turning", 1200);
      await page.evaluate(() => globalThis.lid.forEach((m) => m.play()));
      await revealing;
      await ready();
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
