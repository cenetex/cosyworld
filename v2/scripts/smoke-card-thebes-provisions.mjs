// The Thebes provisions loop in the browser (rules 95): Dione's bread, the
// sanctuary's figs and the gate's wine skin go to Myrto, who packs the Travel
// Provisions; the voyage to Piraeus uses them up; at dawn each ingredient is
// back at home. On the way, the shut City Gate shows its sealed card as a
// locked wooden box, whose play gives the quest that opens it.
//
//   node v2/scripts/smoke-card-thebes-provisions.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { profiles } from "../card-game/memory.mjs";
import { DAYLIGHT_TURNS } from "../card-game/pack-rules.mjs";
import { revealCard, selectCard } from "./card-browser-helpers.mjs";

const SET = ["greek-bread", "greek-figs", "greek-wine-skin"];
const output = process.argv[2]
  ? new URL(`file://${process.argv[2].replace(/\/?$/u, "/")}`)
  : new URL("../../output/thebes-provisions/", import.meta.url);
await mkdir(output, { recursive: true });

const fixture = enableMotives(createWorld());
fixture.actors.vale.place = "greek-courtyard";
fixture.crossings["pond-greek-harbor"].discovered = true;
for (const id of ["lamp", "cloth"]) fixture.items[id].holder = "pond";
fixture.items["greek-water-jar"].holder = "vale";
const save = encodeSave(fixture);

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15_000);
    const table = `thebes-provisions-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
      { key, save, seen: Object.keys(profiles) },
    );
    await page.route("**/card-game/text", async (route) => {
      const input = route.request().postDataJSON();
      await route.fulfill({
        json: {
          revision: input.revision,
          model: "thebes-provisions-fixture",
          entries: input.entities.map(({ id }) => ({
            id,
            text: `${profiles[id]?.name || id} watches.`,
          })),
        },
      });
    });
    const state = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const card = (id) => page.locator(`#hand [data-card="${id}"]`);
    const ready = async () => {
      for (let i = 0; i < 375; i++) {
        if (await page.locator("#dialogue-advance").isVisible())
          await page.locator("#dialogue-advance").click();
        if (
          (await page.locator("#hand").getAttribute("data-cooling")) === "false"
        )
          return;
        await page.waitForTimeout(40);
      }
      throw new Error(`The hand stayed busy: ${errors.join("; ")}`);
    };
    const shot = async (name) => {
      await page.waitForTimeout(900);
      await page.screenshot({
        path: new URL(`${name}-${width}.png`, output).pathname,
      });
    };
    const primary = async (...ids) => {
      await ready();
      await page.keyboard.press("Escape");
      for (const id of ids) await selectCard(page, id);
      await page.locator("#card-actions .card-primary").click();
      await ready();
    };
    const go = async (...places) => {
      for (const place of places) await primary(place);
      assert.equal((await state()).actors.vale.place, places.at(-1));
    };

    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    await card("greek-baker").waitFor({ state: "attached" });
    await ready();
    // The water jar to Dione puts a loaf on her table.
    await primary("greek-water-jar", "greek-baker");
    await card("greek-bread").waitFor({ state: "attached" });
    await shot("01-bread-on-dione-table");
    await primary("greek-bread");
    await go("greek-palace", "greek-sanctuary");
    await primary("greek-figs");
    await shot("02-figs-at-the-sanctuary");
    await go("greek-palace", "greek-courtyard", "greek-gate");

    // The shut gate shows the battlefield as a locked wooden box: the
    // carved lid, no painting and no name.
    const sealed = card("greek-battlefield");
    await sealed.waitFor({ state: "attached" });
    assert.equal(await sealed.getAttribute("data-locked"), "true");
    await revealCard(page, "greek-battlefield");
    assert.equal(await sealed.locator(".name").textContent(), "");
    assert.equal(await sealed.locator(".card-back").isVisible(), true);
    assert.equal(await sealed.locator(".art img").first().isVisible(), false);
    await shot("03-sealed-gate-card");
    await page.keyboard.press("Escape");
    await selectCard(page, "greek-battlefield");
    const play = page.locator("#card-actions .card-primary");
    assert.equal(await play.textContent(), "Seek the way");
    assert.match(
      await play.getAttribute("title"),
      /Burial Decree or Creon's writ/u,
    );
    await shot("04-sealed-card-context");
    const turn = (await state()).turn;
    await page.locator("#card-actions .card-primary").click();
    await ready();
    const quested = await state();
    assert.equal(quested.turn, turn, "taking the quest passes no turn");
    assert.deepEqual(quested.actors.vale.want.step, {
      verb: "give",
      to: "greek-guard",
    });
    assert.equal(quested.actors.vale.want.target, "greek-decree");
    // With the quest on top, the sealed card's context button says why.
    await page.keyboard.press("Escape");
    await selectCard(page, "greek-battlefield");
    assert.match(
      await page.locator('#card-actions [data-blocked="gate"]').textContent(),
      /Burial Decree or Creon's writ/u,
    );
    await shot("05-sealed-card-after-quest");
    await page.keyboard.press("Escape");
    // The quest folds onto Vale's card; opening it shows the quest card.
    const fold = page.locator(
      '#hand .card-frame:has(> [data-card="vale"]) > .quest-fold',
    );
    await fold.dispatchEvent("click");
    await page.locator("#hand [data-want]").first().waitFor();
    await shot("06-gate-quest-issued");
    await page.locator("#hand .quest-fold").first().dispatchEvent("click");
    await ready();

    await primary("greek-wine-skin");
    const gathered = await state();
    for (const id of SET) assert.equal(gathered.items[id].holder, "vale");
    await go("greek-courtyard", "greek-road-thebes", "greek-harbor");
    // Giving Myrto any of the set while holding all three packs the load.
    await primary("greek-figs", "greek-shipmaster");
    const packed = await state();
    assert.equal(packed.items["greek-provisions"].holder, "greek-harbor");
    assert.deepEqual(packed.usedUp, [...SET].sort());
    await card("greek-provisions").waitFor({ state: "attached" });
    await shot("07-provisions-on-the-landing");

    // Aboard, the provisions open the Piraeus course; arriving spends them.
    await primary("greek-provisions");
    await primary("greek-ship");
    await primary("greek-piraeus");
    for (
      let n = 0;
      n < 4 && (await state()).transports["greek-ship"].phase !== "arrived";
      n++
    )
      await primary("greek-ship");
    const spent = await state();
    assert.ok(spent.usedUp.includes("greek-provisions"));
    assert.ok(
      spent.log.some(
        (e) => e.text === "The voyage uses up the Travel Provisions.",
      ),
    );
    await shot("08-voyage-spends-provisions");
    // The way home is free.
    await primary("greek-harbor");
    for (
      let n = 0;
      n < 4 &&
      !legalActions(decodeSave(JSON.stringify(await state()))).some(
        (a) => a.kind === "move" && a.target === "greek-harbor",
      );
      n++
    )
      await primary("greek-ship");
    await primary("greek-harbor");
    assert.equal((await state()).actors.vale.place, "greek-harbor");

    // The night passes (the clock jumps to just before dawn); a Wait
    // through dawn brings each ingredient back at home.
    const late = await state();
    late.turn =
      (Math.floor(late.turn / DAYLIGHT_TURNS / 2) + 1) * 2 * DAYLIGHT_TURNS - 1;
    late.revision = Math.max(late.revision, late.turn);
    await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
      key,
      save: encodeSave(decodeSave(JSON.stringify(late))),
    });
    await page.reload();
    await card("greek-harbor").waitFor({ state: "attached" });
    await ready();
    await primary("greek-harbor");
    const dawn = await state();
    assert.deepEqual(dawn.usedUp, ["greek-provisions"]);
    assert.equal(dawn.items["greek-bread"].holder, "greek-courtyard");
    assert.equal(dawn.items["greek-figs"].holder, "greek-sanctuary");
    assert.equal(dawn.items["greek-wine-skin"].holder, "greek-gate");
    await go("greek-road-thebes", "greek-courtyard");
    await card("greek-bread").waitFor({ state: "attached" });
    await shot("09-bread-regrown-at-dawn");
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`Thebes provisions loop: ${width}px passed.`);
  }
} finally {
  await browser?.close();
  server.close();
}
