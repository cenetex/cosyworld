import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { profiles } from "../card-game/memory.mjs";
import {
  clearSelection,
  selectCard,
  smokeWidths,
  tapCard,
} from "./card-browser-helpers.mjs";

const hollow = "greek-polynices-hollow",
  antigone = "greek-antigone";
const rites = [
  "greek-anoint-polynices",
  "greek-shroud-polynices",
  "greek-bury-polynices",
];
let fixture = createWorld();
fixture.turn = fixture.revision = 20;
fixture.crossings["pond-greek-harbor"].discovered = true;
fixture.actors.vale.place = "greek-gate";
fixture.actors.vale.visited.push("pond", "greek-gate");
fixture.items["greek-creon-writ"].holder = "greek-guard";
for (const item of ["greek-oil-flask", "greek-funeral-cloth", "greek-shovel"])
  fixture.items[item].holder = hollow;
for (const match of [
  { kind: "talk", target: antigone },
  { kind: "move", target: "greek-battlefield" },
]) {
  const action = legalActions(fixture).find((a) =>
    Object.entries(match).every(([key, value]) => a[key] === value),
  );
  const result = play(fixture, action);
  assert.ok(result.ok, result.error);
  fixture = result.state;
}
const output =
  process.env.COSYWORLD_POLYNICES_EVIDENCE ||
  new URL("../../output/polynices/", import.meta.url).pathname;
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of smokeWidths([1440, 390])) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    const key = `cosyworld.reflected-shore.v1.polynices-${width}`,
      errors = [],
      failedAssets = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        new URL(response.url()).pathname.includes("/assets/")
      )
        failedAssets.push(`${response.status()} ${response.url()}`);
    });
    await page.addInitScript(
      ({ key, save, seen }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(fixture), seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      await route.fulfill({
        json: {
          revision: input.revision,
          model: "polynices-browser-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: "We will finish the rites together.",
          })),
        },
      });
    });
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const settle = async () => {
      await page.locator("#hand .card").first().waitFor();
      for (let turn = 0; turn < 250; turn++) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(40);
      }
      throw new Error(`Funeral stayed busy at ${width}px`);
    };
    const photograph = async (stage) => {
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        "Page fits viewport",
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#backdrop, #cast img")].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      await page.screenshot({
        path: `${output}/${stage}-${width}.png`,
        fullPage: true,
      });
    };
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=polynices-${width}`,
      );
      await settle();
      await selectCard(page, hollow, { touch: width === 390 });
      await page.locator('#card-actions [data-action="move"]').click();
      await settle();
      assert.equal((await state()).actors.vale.place, hollow);
      assert.equal((await state()).actors[antigone].place, hollow);
      for (const [index, stage] of ["fallen", "anointed", "veiled"].entries()) {
        await clearSelection(page);
        await selectCard(page, "vale", { touch: width === 390 });
        const quest = page.locator('#hand button[data-quest-id="quest:0"]');
        await tapCard(quest);
        await page.waitForFunction(
          () =>
            document.querySelector('#hand button[data-quest-id="quest:0"]')
              ?.dataset.unrevealed === "false",
        );
        await page.waitForFunction(
          () => !document.querySelector("#hand [data-revealing]"),
        );
        assert.ok(
          await page.locator(`#hand img[src*="polynices-${stage}"]`).count(),
          `Quest art ${stage}`,
        );
        await photograph(stage);
        const before = await state();
        await clearSelection(page);
        await selectCard(page, antigone, { touch: width === 390 });
        const button = page.locator(
          `#card-actions [data-choice="${rites[index]}"]`,
        );
        await button.waitFor({ state: "visible" });
        const bounds = await button.boundingBox();
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
          "Rite button fits viewport",
        );
        await photograph(`${stage}-action`);
        await button.click();
        await settle();
        assert.equal(
          (await state()).turn,
          before.turn + 1,
          "Each rite takes one turn",
        );
        const saved = (await state()).packs["greek-drama"];
        await page.reload();
        await settle();
        assert.deepEqual(
          (await state()).packs["greek-drama"],
          saved,
          "Reload keeps the rite",
        );
      }
      const done = await state();
      assert.equal(
        done.packs["greek-drama"].flags["greek-burial-performed"],
        true,
      );
      assert.equal(
        done.packs["greek-drama"].flags["greek-open-door-open"],
        true,
      );
      assert.equal(done.items["greek-oil-flask"].holder, "greek-colonus");
      assert.equal(done.items["greek-funeral-cloth"].holder, "greek-eleusis");
      assert.equal(done.items["greek-shovel"].holder, hollow);
      await photograph("buried");
      assert.deepEqual(errors, []);
      assert.deepEqual(failedAssets, []);
      console.log(
        `Polynices' three rites, quest art, turn timing and reload passed at ${width}px.`,
      );
    } catch (error) {
      await page.screenshot({
        path: `${output}/failed-${width}.png`,
        fullPage: true,
      });
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
