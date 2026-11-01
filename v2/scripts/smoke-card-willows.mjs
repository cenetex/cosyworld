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
import { darkMist, isNight } from "../card-game/daylight.mjs";
import { locationWeather } from "../card-game/weather.mjs";
import images from "../card-game/image-variants.json" with { type: "json" };

// The Willows mist rises beside the ship's rail only on a misty night while
// the ship lies at Black Pond or sails between ports. Saves skip ahead on the
// world clock; the ship is brought home and counts its idle rounds from the
// new turn. The sea mist returns every 48 turns, so a resident is often still
// aboard and would hold back a lamp call; the save sets the dock directly.
const until = (world, ok) => {
  while (!ok(world)) world.turn += 1;
  world.revision = Math.max(world.revision, world.turn);
  if (world.transports["greek-ship"].dock !== "pond")
    Object.assign(world.transports["greek-ship"], {
      phase: "docked",
      dock: "pond",
      destination: null,
      recall: null,
    });
  world.transports["greek-ship"].since = world.turn;
  return world;
};
const untilDarkMist = (world) => until(world, darkMist);
const clearNight = (world) =>
  isNight(world) && locationWeather(world, "greek-ship")?.condition !== "mist";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? {
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
        args: [
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ],
      }
    : {}),
});
const output = new URL("../../output/card-willows/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    let seed = enableMotives(createWorld({ opening: true }));
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
    const willowsCards = () =>
      page.locator('#hand [data-card="willows-landing"]').count();
    const resave = async (world, card = null) => {
      await page.evaluate(({ key, save }) => localStorage.setItem(key, save), {
        key,
        save: JSON.stringify(world),
      });
      await page.reload();
      await page
        .locator(card ? `#hand [data-card="${card}"]` : "#hand [data-card]")
        .first()
        .waitFor();
    };
    await move("greek-ship");
    // By day the deck shows no Willows card.
    assert.equal(isNight(await saved()), false);
    assert.equal(await willowsCards(), 0);
    // On a clear night, still none.
    await resave(until(await saved(), clearNight));
    assert.equal((await saved()).actors.vale.place, "greek-ship");
    assert.equal(await willowsCards(), 0);
    // On a misty night the mist rises beside the rail.
    await resave(untilDarkMist(await saved()), "willows-landing");
    assert.equal(await willowsCards(), 1);
    await page.screenshot({
      path: new URL(`deck-mist-${width}.png`, output).pathname,
    });
    await move("willows-landing");
    assert.match(
      await page.locator("#backdrop").getAttribute("src"),
      /landing-ship-night\.webp/,
    );
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
    // The Swede's pose follows saved discoveries and his place.
    const pose = (name) =>
      page.waitForFunction(
        (name) =>
          [
            ...document.querySelectorAll(
              '#cast [data-avatar="willows-swede"] img',
            ),
          ].some((img) =>
            img.src.split("?")[0].endsWith(`/willows/${name}.webp`),
          ),
        name,
      );
    await pose("swede-seated");
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
    await pose("swede-listening");
    await choose("willows-swede", "compare-signs");
    await pose("swede-worried");
    await choose("willows-swede", "choose-watch");
    await pose("swede-listening");
    const beforeReload = (await saved()).packs.willows;
    await page.reload();
    await page.locator('#hand [data-card="willows-camp"]').waitFor();
    assert.deepEqual((await saved()).packs.willows, beforeReload);
    await move("willows-landing");
    // The mist has lifted by now: no way back to the deck until the next
    // misty night. The save waits out the days.
    const stranded = await saved();
    assert.equal(darkMist(stranded), false);
    assert.equal(
      await page.locator('#hand [data-card="greek-ship"]').count(),
      0,
    );
    await resave(untilDarkMist(stranded), "greek-ship");
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
    // Art follows the latest saved receipt, including base-only signs. Every
    // source is checked after reload at both widths; missing art keeps base.
    let artWorld = createWorld();
    for (const [place, turn, sign, target, base] of [
      ["landing", 0, "examine-hull", "landing-uncanny", "landing"],
      ["landing", 2, "watch-otter", "landing-otter", "landing"],
      ["landing", 4, "watch-boatman", "landing-boatman", "landing"],
      ["camp", 6, "pace-willows", "camp", "camp"],
      ["camp", 24, "pace-again", "camp-closer", "camp-lit-night"],
      ["camp", 26, "listen-tent", "camp-tent-pressure", "camp-lit-night"],
      ["camp", 28, "count-stores", "camp-lit-night", "camp-lit-night"],
      ["thicket", 48, "examine-hollows", "thicket-hollows", "thicket"],
      ["thicket", 72, "look-up-willows", "thicket-bronze", "thicket-night"],
      ["thicket", 96, null, "thicket", "thicket"],
      ["bank", 98, "hear-humming", "bank-humming", "bank"],
      ["bank", 100, "look-beneath-roots", "bank-roots", "bank"],
      ["bank", 120, null, "bank-drowned", "bank-night"],
    ]) {
      artWorld.actors.vale.place = `willows-${place}`;
      artWorld.turn = artWorld.revision = turn;
      if (sign) {
        const result = play(
          artWorld,
          legalActions(artWorld).find((a) => a.choiceId === `willows-${sign}`),
        );
        assert(result.ok, result.error);
        artWorld = result.state;
      }
      await resave(artWorld);
      const file = `assets/willows/${target}.webp`;
      const expected = images.images[file]?.stage
        ? file
        : `assets/willows/${base}.webp`;
      await page.waitForFunction((file) => {
        const img = document.querySelector("#backdrop");
        return (
          img?.complete &&
          img.naturalWidth &&
          new URL(img.src).pathname.endsWith(file)
        );
      }, expected);
      await page.evaluate(async () => {
        await document.querySelector("#backdrop").decode();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      await page.screenshot({
        path: new URL(`sign-${target}-${width}.png`, output).pathname,
      });
      assert.deepEqual((await saved()).packs.willows, artWorld.packs.willows);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(mediaFailures, []);
    await page.close();
    console.log(`Willows browser play passed at ${width} × ${height}.`);
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
