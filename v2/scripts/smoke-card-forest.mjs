import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { legalActions } from "../card-game/world.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
const out = new URL("../../output/card-forest/", import.meta.url).pathname;
await mkdir(out, { recursive: true });
const server = createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const reports = [];
try {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    console.log("Standard Chromium launch:", error.message.split("\n")[0]);
    browser = await chromium.launch({
      headless: true,
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });
  }
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15000);
    const table = `forest-fresh-${width}-${Date.now()}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const report = {
      width,
      table,
      errors: [],
      failedAssets: [],
      steps: [],
      screenshots: [],
      dialogueStub: true,
    };
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("response", (res) => {
      if (res.status() >= 400 && res.url().includes("/assets/"))
        report.failedAssets.push(`${res.status()} ${res.url()}`);
    });
    await page.addInitScript(() => {
      localStorage.setItem("cosyworld.dialogue.sound", "off");
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
    });
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      await route.fulfill({
        json: {
          revision: input.revision,
          model: "forest-browser-contract",
          entries: input.entities.map(({ id }) => ({
            id,
            text:
              input.disclosures?.find((fact) => fact.speaker === id)?.text ||
              (id === "whiskerwind"
                ? "🌧️🐾🏠☕"
                : id === "skull"
                  ? "Skull turns his ears toward the path."
                  : id === "rati"
                    ? "The blue wool is beside the basket."
                    : id === "oak"
                      ? "Root counts the footsteps beside the garden."
                      : "I can see the path from here."),
          })),
        },
      });
    });
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const settle = async () => {
      for (let count = 0; count < 300; count++) {
        if (await page.locator("#unveil-dialog[open]").count())
          await page.keyboard.press("Escape");
        else if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (await page.locator("#story-retry").isVisible())
          throw new Error(
            `Story retry ${await page.locator("#story-retry").textContent()}`,
          );
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) ===
            "false" &&
          (await page.locator("#hand .card").count())
        )
          return;
        await page.waitForTimeout(40);
      }
      throw new Error(`Busy scene at ${width}`);
    };
    const shot = async (label) => {
      await settle();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#backdrop, #cast img, #hand img")]
          .filter((image) => {
            const r = image.getBoundingClientRect();
            return (
              r.width &&
              r.height &&
              r.right > 0 &&
              r.left < innerWidth &&
              r.bottom > 0 &&
              r.top < innerHeight
            );
          })
          .every((image) => image.complete && image.naturalWidth > 0),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Page fits viewport",
      );
      const path = `${out}/${label}-${width}.png`;
      await page.screenshot({ path, fullPage: true });
      report.screenshots.push(path);
    };
    const step = async (kind, fields = {}) => {
      await settle();
      await page.keyboard.press("Escape");
      const before = await state();
      const action = legalActions(before).find(
        (a) =>
          a.kind === kind &&
          Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      assert.ok(
        action,
        `Missing ${kind} ${JSON.stringify(fields)} at ${before.actors.vale.place}; choices ${legalActions(
          before,
        )
          .map((a) => `${a.kind}:${a.target || a.item || a.choiceId}`)
          .join(", ")}`,
      );
      for (const card of action.cards || [])
        await selectCard(page, card, { touch: width === 390 });
      const selector = action.choiceId
        ? `#card-actions [data-choice="${action.choiceId}"]`
        : `#card-actions [data-action="${kind}"]`;
      const button = page.locator(selector).filter({ visible: true });
      await button.first().click();
      await settle();
      const after = await state();
      assert.equal(after.turn, before.turn + 1, "One click commits one turn");
      if (kind === "move") assert.equal(after.actors.vale.place, fields.target);
      report.steps.push({
        turn: after.turn,
        kind,
        ...fields,
        place: after.actors.vale.place,
      });
      console.log(JSON.stringify({ width, step: report.steps.at(-1) }));
    };
    try {
      await page.goto(`${origin}/?table=${table}`);
      await settle();
      const initial = await state();
      assert.equal(initial.turn, 0);
      assert.equal(initial.actors.vale.place, "attic");
      assert.equal(initial.items.lamp.lit, false);
      assert.ok(
        legalActions(initial).some(
          (a) => a.kind === "light" && a.item === "lamp",
        ),
      );
      assert.ok(
        !legalActions(initial).some(
          (a) => a.kind === "move" && a.target === "forest-cottage",
        ),
      );
      await shot("fresh-attic");
      await step("light", { item: "lamp" });
      await step("move", { target: "pond" });
      await step("give", { item: "lamp", target: "moth" });
      if ((await state()).items.cloth.holder !== "vale")
        await step("ask", {
          item: "cloth",
          target: (await state()).items.cloth.holder,
        });
      assert.equal(
        (await state()).items.cloth.holder,
        "vale",
        "Pip hands over the cloth after the gift",
      );
      await step("move", { target: "attic" });
      await shot("attic-cloth-gate");
      await step("move", { target: "forest-cottage" });
      await shot("cottage-arrival");
      await step("talk", { target: "rati" });
      await step("choose", { choiceId: "forest-stay-for-tea" });
      await step("take", { item: "forest-story-button" });
      await step("give", { item: "forest-story-button", target: "rati" });
      await step("choose", { choiceId: "forest-mend-scarf" });
      await shot("cottage-scarf");
      await step("move", { target: "forest-garden" });
      await step("choose", {
        choiceId: width === 1440 ? "forest-clear-drain" : "forest-set-stones",
      });
      await step("take", { item: "forest-dewbright-button" });
      await step("choose", { choiceId: "forest-share-symbols" });
      await shot("garden-symbols");
      if (width === 390) {
        const box = await page
          .locator("#cast [data-avatar=whiskerwind]")
          .boundingBox();
        assert.ok(
          box.x >= 0 && box.x + box.width <= width,
          "Whiskerwind fits the phone frame",
        );
      }
      if (width === 1440) await step("take", { item: "forest-watch-bell" });
      await step("move", { target: "forest-trail" });
      await step("talk", { target: "skull" });
      await step("choose", {
        choiceId:
          width === 1440 ? "forest-set-watch-bell" : "forest-mark-pawprints",
      });
      await step("take", { item: "forest-wolfprint-charm" });
      await shot("trail-watch");
      if (width === 390) {
        const box = await page
          .locator("#cast [data-avatar=skull]")
          .boundingBox();
        assert.ok(
          box.x >= 0 && box.x + box.width <= width,
          "Skull fits the phone frame",
        );
      }
      await step("move", { target: "forest-garden" });
      await step("move", { target: "forest-oak" });
      await step("talk", { target: "oak" });
      await step("choose", {
        choiceId: width === 1440 ? "forest-tell-hearth" : "forest-tell-path",
      });
      await shot("oak-account");
      assert.equal(
        await page.locator("#cast [data-avatar=oak]").count(),
        0,
        "Oak remains in the place art",
      );
      assert.ok(
        await page.locator("#hand [data-card=oak]").count(),
        "Oak keeps his card",
      );
      const beforeReload = (await state()).packs["lonely-forest"];
      await page.reload();
      await settle();
      assert.deepEqual((await state()).packs["lonely-forest"], beforeReload);
      await step("move", { target: "forest-garden" });
      await step("move", { target: "forest-cottage" });
      await step("choose", {
        choiceId: width === 1440 ? "forest-leave-charm" : "forest-keep-charm",
      });
      await shot("cottage-homecoming");
      await step("move", { target: "attic" });
      await shot("attic-return");
      const final = await state();
      assert.equal(
        final.packs["lonely-forest"].flags["forest-homecoming-shared"],
        true,
      );
      assert.equal(report.errors.length, 0);
      assert.deepEqual(report.failedAssets, []);
      report.ok = true;
      report.finalTurn = final.turn;
      report.ending = final.packs["lonely-forest"].choices["forest-homecoming"];
    } catch (error) {
      report.ok = false;
      report.error = error.stack;
      await page.screenshot({
        path: `${out}/failure-${width}.png`,
        fullPage: true,
      });
      console.log("FAIL", width, error.stack);
      const failed = await state();
      console.log(
        "STATE",
        JSON.stringify({
          place: failed.actors.vale.place,
          items: failed.items,
          latest: failed.log.slice(-6),
        }),
      );
      await writeFile(
        `${out}/failed-save-${width}.json`,
        JSON.stringify(failed),
      );
    }
    reports.push(report);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(
    `${out}/report.json`,
    JSON.stringify(reports, null, 2) + "\n",
  );
  console.log(JSON.stringify(reports, null, 2));
}
if (reports.some((r) => !r.ok)) process.exitCode = 1;
