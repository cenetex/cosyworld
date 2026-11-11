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
import { questFor } from "../card-game/talk-quest.mjs";
import { setWant } from "../card-game/want.mjs";
import {
  clearSelection,
  readyActionButton,
  selectCard,
  smokeWidths,
  tapCard,
} from "./card-browser-helpers.mjs";

const hollow = "greek-polynices-hollow",
  antigone = "greek-antigone";
const kit = ["greek-oil-flask", "greek-funeral-cloth", "greek-shovel"];
const rites = [
  "greek-anoint-polynices",
  "greek-shroud-polynices",
  "greek-bury-polynices",
];
let fixture = createWorld();
// Reach the shade on the last night turn, then commit the Talk at dawn.
fixture.turn = fixture.revision = 45;
fixture.crossings["pond-greek-harbor"].discovered = true;
fixture.actors.vale.place = "greek-gate";
fixture.actors.vale.visited.push("pond", "greek-gate");
fixture.items["greek-creon-writ"].holder = "greek-guard";
fixture.items.lamp.holder = "attic";
for (const item of kit) fixture.items[item].holder = "vale";
fixture.items[kit[0]].holder = hollow;
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
// Talk tells the burial and the player takes it with a tap (Accept quest, a
// later package). Until that play exists, take it here as the tap would.
{
  const teller = [antigone, "greek-polynices-shade"].find(
    (id) => fixture.actors[id]?.want?.step?.verb === "lay",
  );
  assert.ok(teller, "someone tells the burial");
  setWant(fixture.actors.vale, questFor(fixture, teller, fixture.actors[teller].want));
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
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function (...args) {
          if (this.src.includes("hillside-sanctuary")) window.funeralSong = this;
          return play.apply(this, args);
        };
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
        animations: "disabled",
      });
    };
    try {
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?table=polynices-${width}`,
      );
      await settle();
      const funeral = page.locator('button[data-quest-key*="greek-polynices-hollow"]');
      const showState = async (world) => {
        await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
          key, save: encodeSave(world),
        });
        await page.reload();
        await settle();
      };
      for (const missing of ["place", antigone, ...kit]) {
        const world = structuredClone(fixture);
        world.actors.vale.place = hollow;
        world.actors[antigone].place = hollow;
        for (const item of kit) world.items[item].holder = hollow;
        if (missing === "place") world.actors.vale.place = "greek-courtyard";
        else if (missing === antigone) world.actors[antigone].place = "greek-gate";
        else world.items[missing].holder = "greek-courtyard";
        await showState(world);
        assert.equal(await funeral.count(), 0, `Rite waits for ${missing}`);
        assert.equal(await page.locator('[data-quest-step]').count(), 0);
        if (missing === "place") await photograph("courtyard-quest");
      }
      await showState(fixture);
      await selectCard(page, hollow, { touch: width === 390 });
      const locked = page.locator(`#hand [data-card="${hollow}"]`);
      assert.equal(await locked.getAttribute("data-locked"), "true");
      assert.equal(await page.locator('#card-actions [data-blocked="gate"]').getAttribute("title"), await page.locator(".action-beat-text").textContent());
      assert.equal(await page.locator('#card-actions [data-action="gate"]').count(), 0);
      await photograph("locked");
      assert.equal((await state()).turn, 47, "Talk is chosen on the last night turn");
      await clearSelection(page);
      await selectCard(page, "greek-polynices-shade", { touch: width === 390 });
      await readyActionButton(page, "talk").click();
      await settle();
      assert.equal((await state()).packs["greek-drama"].flags["greek-polynices-heard"], true);
      assert.equal((await state()).turn, 48, "Talk commits at dawn");
      await page.reload();
      await settle();
      await selectCard(page, hollow, { touch: width === 390 });
      assert.equal(await locked.getAttribute("data-locked"), "false");
      await readyActionButton(page, "move").waitFor();
      await photograph("opened");
      await readyActionButton(page, "move").click();
      await settle();
      assert.equal((await state()).actors.vale.place, hollow);
      assert.equal((await state()).actors[antigone].place, hollow);
      const quest = page.locator('#hand button[data-quest-id="quest:0"]');
      const pickQuest = async () => {
        await clearSelection(page);
        await selectCard(page, "vale", { touch: width === 390 });
        await tapCard(quest);
        await page.waitForFunction(
          () => !document.querySelector("#hand [data-revealing]"),
        );
        if ((await quest.getAttribute("data-picked")) === "false")
          await tapCard(quest);
        await page.locator('#hand button[data-quest-id="quest:0"][data-unrevealed="false"]').waitFor();
        await page.waitForFunction(() => !document.querySelector("#hand [data-revealing]"));
      };
      await pickQuest();
      const ready = await state();
      for (const missing of [antigone, kit[1]]) {
        const changed = structuredClone(ready);
        if (missing === antigone) changed.actors[antigone].place = "greek-gate";
        else changed.items[missing].holder = "greek-courtyard";
        for (const saved of [changed, ready]) {
          await page.evaluate(({ key, saved }) => {
            const newValue = JSON.stringify(saved);
            localStorage.setItem(key, newValue);
            window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
          }, { key, saved });
          await settle();
          if (saved === changed) {
            assert.equal(await funeral.count(), 0, `Selected rite clears when ${missing} leaves`);
            assert.equal(await page.locator("[data-quest-step]").count(), 0);
          } else await pickQuest();
        }
      }
      assert.equal(await page.locator("[data-quest-step]").count(), 0);
      assert.equal(await page.locator("[data-drop-quest]").count(), 1);
      await clearSelection(page);
      await selectCard(page, kit[0]);
      await readyActionButton(page, "take").click();
      await settle();
      assert.equal((await state()).items[kit[0]].holder, "vale");
      for (const [index, stage] of ["fallen", "anointed", "veiled"].entries()) {
        await pickQuest();
        assert.equal(await quest.locator(".quest-verb").textContent(), ["Anoint", "Veil", "Bury"][index]);
        assert.ok(
          await page.locator(`#hand img[src*="polynices-${stage}"]`).count(),
          `Quest art ${stage}`,
        );
        await photograph(stage);
        const before = await state();
        const button = page.locator(
          '#card-actions [data-quest-step][data-action="give"]:not([data-revealing="true"])',
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
        assert.equal(saved.receipts[rites[index]], before.turn + 1);
        if (index < 2) {
          await page.reload();
          await settle();
        }
        assert.deepEqual(
          (await state()).packs["greek-drama"],
          saved,
          "The rite stays saved",
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
      // A real Move keeps the started funeral performance through its end.
      await page.waitForFunction(() => window.funeralSong && !window.funeralSong.paused);
      const musicBefore = await page.evaluate(() => ({
        position: window.funeralSong.currentTime,
        duration: window.funeralSong.duration,
        loop: window.funeralSong.loop,
      }));
      assert.equal(musicBefore.loop, false);
      assert.ok(musicBefore.duration > 30);
      for (const place of ["greek-battlefield", "greek-gate", "greek-courtyard"]) {
        await clearSelection(page);
        await selectCard(page, place, { touch: width === 390 });
        await readyActionButton(page, "move").click();
        await settle();
        assert.equal((await state()).actors.vale.place, place);
      }
      await page.waitForFunction((position) =>
        !window.funeralSong.paused && window.funeralSong.currentTime > position + 0.2,
      musicBefore.position);
      assert.equal(await page.locator("#room-music").evaluate((a) => a.paused), true);
      await photograph("funeral-song-after-travel");
      await page.evaluate(() => {
        window.funeralSong.currentTime = window.funeralSong.duration - 0.25;
      });
      await page.waitForFunction(() => window.funeralSong.ended);
      await page.waitForFunction(() => !document.querySelector("#room-music").paused);
      assert.match(await page.locator("#room-music").getAttribute("src"), /greek-courtyard/);
      const completedRites = (await state()).packs["greek-drama"];
      await page.reload();
      await settle();
      assert.deepEqual((await state()).packs["greek-drama"], completedRites, "Reload keeps the final rite");
      assert.equal((await state()).actors.vale.place, "greek-courtyard");
      assert.equal(await page.evaluate(() => Boolean(window.funeralSong)), false);
      console.log(JSON.stringify({ width, funeralMusic: musicBefore, travelled: true, ended: true, reload: true }));
      // The met funeral quest pays its experience on the last rite and goes:
      // there is nothing to claim.
      assert.equal(done.actors.vale.want, null);
      assert.ok(done.actors.vale.xp > ready.actors.vale.xp);
      assert.equal(await page.locator("#hand .want-card").count(), 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(failedAssets, []);
      console.log(
        `Polynices' three rites, quest art, turn timing and reload passed at ${width}px.`,
      );
    } catch (error) {
      await page.screenshot({
        path: `${output}/failed-${width}.png`,
        fullPage: true,
        animations: "disabled",
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
