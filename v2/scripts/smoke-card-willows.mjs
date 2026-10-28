import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
} from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";
import { selectCard } from "./card-browser-helpers.mjs";
import { summonTransport } from "../card-game/pack-transport.mjs";
import { profiles } from "../card-game/memory.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
const output = new URL("../../output/card-willows/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    let seed = enableMotives(createWorld({ opening: true }), {
      questPrograms: true,
      personalQuests: true,
    });
    for (const fields of [
      { kind: "light", item: "lamp" },
      { kind: "move", target: "pond" },
    ]) {
      const action = legalActions(seed).find((a) =>
        Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      const result = play(seed, action);
      assert(result.ok);
      seed = result.state;
    }
    seed.crossings["pond-greek-harbor"].discovered = true;
    summonTransport(seed, "greek-ship", "pond");
    const table = `willows-${width}`;
    const key = `cosyworld.reflected-shore.v1.${table}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const readingCounts = [];
    const errors = [],
      mediaFailures = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/assets/") && response.status() >= 400)
        mediaFailures.push(response.url());
    });
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { key, save: encodeSave(seed) },
    );
    // The browser smoke checks controls and layout. Server tests check the rules.
    await page.route("**/card-game/text", (route) => {
      const input = route.request().postDataJSON();
      const swede = input.entities.find((e) => e.id === "willows-swede");
      if (swede) readingCounts.push(swede.readings?.length || 0);
      return route.fulfill({
        json: {
          revision: input.revision,
          model: "willows-ui-smoke",
          entries: input.entities.map((e) => ({
            id: e.id,
            text:
              e.id === "willows-swede"
                ? "Stay close. I heard it through the sand."
                : profiles[e.id]?.kind === "location"
                  ? "I feel the river pulling at my edge."
                  : "I will stay close to the camp.",
          })),
        },
      });
    });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=${table}`,
    );
    const saved = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const click = async (card, selector) => {
      const before = (await saved()).revision;
      await page.keyboard.press("Escape");
      await selectCard(page, card);
      await page.locator(`#card-actions ${selector}`).click();
      await page.waitForFunction(
        ({ key, before }) =>
          JSON.parse(localStorage.getItem(key)).revision > before,
        { key, before },
      );
      await page.waitForFunction(
        () => !document.querySelector("#card-actions button[disabled]"),
      );
    };
    const move = (target) => click(target, '[data-action="move"]');
    const choose = (place, id) => click(place, `[data-choice="willows-${id}"]`);
    await move("greek-ship");
    await move("willows-landing");
    await choose("willows-landing", "examine-hull");
    await move("willows-camp");
    await choose("willows-camp", "count-stores");
    await click("willows-swede", '[data-action="talk"]');
    const portrait = page
      .locator('#cast [data-avatar="willows-swede"] img')
      .first();
    await portrait.waitFor();
    assert(
      await portrait.evaluate((img) => img.complete && img.naturalWidth > 0),
    );
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: new URL(`camp-${width}.png`, output).pathname,
    });
    await move("willows-thicket");
    await choose("willows-thicket", "examine-hollows");
    await move("willows-bank");
    await choose("willows-bank", "hear-humming");
    await choose("willows-bank", "look-beneath-roots");
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: new URL(`bank-${width}.png`, output).pathname,
    });
    await move("willows-thicket");
    await move("willows-camp");
    await choose("willows-swede", "compare-signs");
    await choose("willows-swede", "choose-watch");
    const beforeReload = (await saved()).packs.willows;
    await page.reload();
    await page.locator('#hand [data-card="willows-camp"]').waitFor();
    assert.deepEqual((await saved()).packs.willows, beforeReload);
    await move("willows-landing");
    await move("greek-ship");
    assert.equal((await saved()).actors.vale.place, "greek-ship");
    assert.equal(
      (await saved()).packs.willows.choices["willows-response"],
      "watch",
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(mediaFailures, []);
    assert(readingCounts[0] < 7);
    assert.equal(Math.max(...readingCounts), 7);
    await page.close();
    console.log(`Willows browser play passed at ${width} × ${height}.`);
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
