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
const browser = await chromium.launch({ headless: true });
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
    const loreRequests = [];
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
      loreRequests.push(input.entities.some((e) => "readings" in e));
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
    // Source passages are lore, never part of a speech request.
    assert(loreRequests.length > 0);
    assert(!loreRequests.includes(true));
    await page.close();
    console.log(`Willows browser play passed at ${width} × ${height}.`);
  }
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
