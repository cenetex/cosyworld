// Closed boxes show their authored quest requirement in the existing action beat.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { isLockedBox, lockedQuest } from "../card-game/locked-box.mjs";
import { profiles } from "../card-game/memory.mjs";
import { sleepWindow } from "../card-game/resident-sleep.mjs";
import { revealCard, tapCard, selectCard } from "./card-browser-helpers.mjs";
const output = new URL(
  process.argv[2]
    ? `file://${process.argv[2].replace(/\/?$/u, "/")}`
    : "../../output/lock-quests/",
  import.meta.url,
);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height, reducedMotion] of [
    [1920, 1080, "reduce"],
    [1440, 900, "reduce"],
    [390, 844, "reduce"],
    [360, 740, "reduce"],
    [1440, 900, "no-preference"],
    [390, 844, "no-preference"],
  ]) {
    for (const [id, place] of [
      ["greek-provisions", "greek-harbor"],
      ["greek-piraeus", "greek-ship"],
      ["greek-bread", "greek-courtyard"],
      ["greek-battlefield", "greek-gate"],
      ["greek-polynices-hollow", "greek-battlefield"],
    ]) {
      const world = createWorld();
      world.packs["greek-drama"].scope = "full";
      world.actors.vale.place = place;
      if (place === "greek-ship")
        world.transports["greek-ship"].dock = "greek-harbor";
      if (id === "greek-polynices-hollow") world.turn = world.revision = 36;
      if (id === "greek-battlefield") {
        world.actors["greek-antigone"].place = place;
        const sleep = sleepWindow(world, "greek-antigone", 1);
        world.turn = world.revision = sleep.start;
        world.actors["greek-antigone"].sleeping = {
          since: sleep.start,
          place,
          until: sleep.end,
        };
      }
      const encountered = new Set([
        ...Object.keys(profiles),
        ...availableCards(world),
      ]);
      const expected = lockedQuest(
        world,
        id,
        (target) => encountered.has(target) && !isLockedBox(world, target),
      );
      assert(expected, `${id} is locked`);
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: width < 700,
        reducedMotion,
      });
      const key = `cosyworld.reflected-shore.v1.lock-${id}-${width}`;
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(
        ({ key, save, seen }) => {
          localStorage.setItem(key, save);
          localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
          localStorage.setItem("cosyworld.dialogue.sound", "off");
          localStorage.setItem(
            "cosyworld.room-music",
            JSON.stringify({ enabled: false }),
          );
        },
        { key, save: encodeSave(world), seen: Object.keys(profiles) },
      );
      await page.route("**/card-game/text", (r) =>
        r.fulfill({ status: 503, body: "" }),
      );
      await page.route("**/card-game/reflections", (r) =>
        r.fulfill({ status: 503, body: "" }),
      );
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=lock-${id}-${width}`,
      );
      await page
        .locator(`#hand [data-card="${id}"]`)
        .waitFor({ state: "attached" });
      const before = await page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key));
        return {
          turn: state.turn,
          revision: state.revision,
          eventSeq: state.eventSeq,
          log: state.log,
          quests: Object.fromEntries(
            Object.entries(state.actors).map(([id, actor]) => [
              id,
              { want: actor.want, under: actor.under },
            ]),
          ),
          packs: Object.fromEntries(
            Object.entries(state.packs).map(([id, pack]) => [
              id,
              { flags: pack.flags, receipts: pack.receipts },
            ]),
          ),
        };
      }, key);
      await tapCard(await revealCard(page, id));
      const text = page.locator(".action-beat-text");
      assert.equal(await text.textContent(), expected.text);
      assert.equal(await text.getAttribute("data-revealing"), "false");
      const images = page.locator(".action-beat-cards img");
      assert.equal(await images.count(), 1);
      assert.match(
        await images.first().getAttribute("src"),
        /card-back-locked(?:[.-]card)?\.webp/u,
      );
      assert.deepEqual(
        await images.evaluateAll((nodes) =>
          nodes.flatMap((node) => node.dataset.entity || []).sort(),
        ),
        [...expected.cards].sort(),
      );
      assert.equal(
        await page.locator(".action-beat-cards [data-recipe]").count(),
        expected.recipe ? 1 : 0,
      );
      const button = page.locator('#card-actions [data-blocked="gate"]');
      {
        assert.equal(await button.count(), 1);
        assert.equal(await button.textContent(), "Locked");
        assert(await button.isDisabled());
        assert.equal(
          await button.getAttribute("aria-label"),
          `Locked. ${expected.text}`,
        );
        assert.equal(await button.getAttribute("data-tap-verb"), null);
        assert.equal(
          await page.locator("#action-beat").getAttribute("data-card-tap"),
          "hint",
        );
        const status = await button.evaluate((n) => {
          const range = document.createRange();
          range.selectNodeContents(n);
          const text = range.getBoundingClientRect();
          const panel = n.closest("#action-beat").getBoundingClientRect();
          const style = getComputedStyle(n);
          return {
            font: style.fontSize,
            right: panel.right - text.right,
            bottom: panel.bottom - text.bottom,
            divider: getComputedStyle(n.parentElement).display,
          };
        });
        assert.equal(status.font, "10px");
        assert(
          Math.abs(status.right - 13) <= 2,
          "same right inset as Continue",
        );
        assert(
          status.bottom >= 5 && status.bottom <= 10,
          "small bottom corner status",
        );
        assert.equal(status.divider, "contents", "no separate button row");
        await button.click({ force: true });
        await button.dispatchEvent("click");
        await page.locator(`#hand [data-card="${id}"]`).focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Enter");
        assert.equal(await button.textContent(), "Locked");
        assert.equal(
          await page.locator('#card-actions [data-action="gate"]').count(),
          0,
        );
      }
      const fits = await text.evaluate((n) => {
        const r = document.createRange();
        r.selectNodeContents(n);
        return (
          r.getBoundingClientRect().height <=
          n.getBoundingClientRect().height + 1
        );
      });
      assert(fits, `complete quest at ${width}: ${expected.text}`);
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".action-beat-cards img")].every(
          (i) => i.complete && i.naturalWidth > 0,
        ),
      );
      await page.waitForTimeout(900);
      assert(
        await images.evaluateAll((nodes) =>
          nodes.every((n) => n.clientWidth > 0 && n.clientHeight >= 25),
        ),
        "quest pictures are drawn",
      );
      await page.screenshot({
        path: new URL(`${id}-scene-${width}-${reducedMotion}.png`, output)
          .pathname,
      });
      if (id === "greek-battlefield") {
        await page.keyboard.press("Escape");
        await selectCard(page, "greek-antigone");
        await selectCard(page, id);
        assert.equal(await page.locator("#card-actions button").count(), 1);
        assert.equal(await button.textContent(), "Locked");
        assert.equal(
          await page.locator('#card-actions [data-blocked="asleep"]').count(),
          0,
        );
        assert.equal(await text.textContent(), "A locked box.");
        assert.equal(await images.count(), 1);
        await page.screenshot({
          path: new URL(`paired-${width}-${reducedMotion}.png`, output)
            .pathname,
        });
      }
      const after = await page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key));
        return {
          turn: state.turn,
          revision: state.revision,
          eventSeq: state.eventSeq,
          log: state.log,
          quests: Object.fromEntries(
            Object.entries(state.actors).map(([id, actor]) => [
              id,
              { want: actor.want, under: actor.under },
            ]),
          ),
          packs: Object.fromEntries(
            Object.entries(state.packs).map(([id, pack]) => [
              id,
              { flags: pack.flags, receipts: pack.receipts },
            ]),
          ),
        };
      }, key);
      assert.deepEqual(
        after,
        before,
        "preview creates no quest or play outcome",
      );
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log(`Anonymous boxes and unchanged turns passed at ${width}px.`);
  }
} finally {
  await browser.close();
  server.close();
}
