import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  legalActions,
  play,
} from "../card-game/world.mjs";
import { revealCard, tapCard } from "./card-browser-helpers.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const key = `cosyworld.reflected-shore.v1.lamp-${width}`;
    const initial = createWorld();
    const world = play(
      initial,
      legalActions(initial).find((a) => a.kind === "take" && a.item === "lamp"),
    ).state;
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false, volume: 0 }),
        );
      },
      { key, save: encodeSave(world) },
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?table=lamp-${width}`,
    );
    const lamp = await revealCard(page, "lamp");
    await page.waitForFunction(
      () => !document.querySelector("#hand [data-revealing]"),
    );
    const read = () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    await tapCard(lamp);
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key)).actors.vale.heldItem === null,
      key,
    );
    let state = await read();
    assert.equal(state.items.lamp.lit, false);
    assert.equal(state.turn, world.turn);
    assert.equal(state.items.lamp.fuelRooms, 3);
    await page.reload();
    assert.equal((await read()).actors.vale.heldItem, null);
    await tapCard(await revealCard(page, "lamp"));
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key)).actors.vale.heldItem === "lamp",
      key,
    );
    state = await read();
    assert.equal(state.items.lamp.lit, true);
    assert.equal(state.turn, world.turn);
    assert.equal(state.items.lamp.fuelRooms, 3);
    assert.deepEqual(errors, []);
    console.log(`Lamp hold/stow/reload passed at ${width}px.`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
