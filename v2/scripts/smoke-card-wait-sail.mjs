// Wait gives way to another play, and a Wait at sea is Sail (#2027): the
// Forest Clearing's card offers only Ring the Steam Clock, and aboard the
// Greek ship under way the lone Wait reads Sail and carries the voyage on.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const output = resolve(process.env.WAIT_SAIL_OUTPUT || "output/wait-sail");
await mkdir(output, { recursive: true });

function clearing() {
  const world = createWorld();
  world.actors.vale.place = "clearing";
  return world;
}
// Board at the harbor and set a course for the pond: the ship is at sea.
function atSea() {
  let world = createWorld();
  world.crossings["pond-greek-harbor"].discovered = true;
  world.actors.vale.place = "greek-harbor";
  for (const pick of [
    (a) => a.kind === "move" && a.target === "greek-ship",
    (a) => a.kind !== "wait" && a.target === "pond",
  ])
    world = play(world, legalActions(world).find(pick)).state;
  assert.equal(world.transports["greek-ship"].phase, "sea");
  return decodeSave(encodeSave(world));
}

async function check(width, name, world, card, label, sentence) {
  const table = `wait-sail-${name}`;
  const page = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce",
    hasTouch: width === 390,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.route("**/card-game/text", (route) =>
    route.fulfill({ status: 503, json: { error: "fixture" } }),
  );
  await page.addInitScript(
    ({ key, save, seen }) => {
      localStorage.setItem(key, save);
      localStorage.setItem(`${key}.seen`, JSON.stringify(seen));
      localStorage.setItem("cosyworld.dialogue.sound", "off");
    },
    {
      key: `cosyworld.reflected-shore.v1.${table}`,
      save: encodeSave(world),
      seen: availableCards(world),
    },
  );
  try {
    await page.goto(`${origin}/?table=${table}`);
    await page.waitForFunction(() => document.body.inert === false);
    await selectCard(page, card, { touch: width === 390 });
    const buttons = page.locator("#card-actions button");
    await page.waitForFunction(
      (label) =>
        document.querySelector("#card-actions button")?.textContent.trim() ===
        label,
      label,
    );
    assert.deepEqual(
      await buttons.evaluateAll((all) => all.map((b) => b.textContent.trim())),
      [label],
    );
    await page.getByRole("button", { name: label, exact: true }).waitFor();
    assert.equal(
      (await page.locator(".action-beat-heading").textContent()).trim(),
      sentence,
    );
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector("#action-beat")).opacity ===
        "1",
    );
    await page.waitForTimeout(400);
    await page.screenshot({
      path: resolve(
        output,
        `${name}-${width}x${width === 390 ? 844 : 900}.png`,
      ),
    });
    assert.deepEqual(errors, []);
    return page;
  } catch (error) {
    await page.close();
    throw error;
  }
}

try {
  for (const width of [1440, 390]) {
    const glade = await check(
      width,
      "clearing",
      clearing(),
      "clearing",
      "Ring the Steam Clock",
      "Vale rings the Steam Clock's bell. The sound rolls between the trees.",
    );
    await glade.close();
    const ship = await check(
      width,
      "ship",
      atSea(),
      "greek-ship",
      "Sail",
      "Vale sails on.",
    );
    // The Sail is the rules' Wait: the ship reaches the pond.
    await ship.locator('#card-actions [data-action="wait"]').click();
    await ship.waitForFunction(
      () =>
        JSON.parse(
          localStorage.getItem("cosyworld.reflected-shore.v1.wait-sail-ship"),
        ).transports["greek-ship"].phase === "arrived",
    );
    await ship.close();
  }
  console.log("wait-sail smoke passed");
} finally {
  await browser.close();
  server.close();
}
