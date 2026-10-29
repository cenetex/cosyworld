import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { summonTransport } from "../card-game/pack-transport.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

// Each browser has its own claimed avatar. The fixture replaces account and
// queue IO; every move runs through the shipping shared-world reducer.
const players = ["vale", "mara", "ash"];
const output = new URL("../../output/shared-ship/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(createWorld()),
    }).world;
    for (const id of players) world.actors[id].place = "pond";
    summonTransport(world, "greek-ship", "pond");
    world.crossings["pond-greek-harbor"].discovered = true;
    const pages = [];
    const contexts = [];
    const errors = [];
    const seen = [
      ...Object.keys(world.actors),
      ...Object.keys(world.items),
      ...Object.keys(world.packs),
      "pond",
      "station",
      "attic",
      "greek-ship",
      "greek-harbor",
    ];
    try {
      for (const actor of players) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 900 },
          reducedMotion: "reduce",
        });
        contexts.push(context);
        await context.addInitScript(
          ({ actor, seen }) => {
            localStorage.setItem(
              `cosyworld.reflected-shore.v1.shared.ship-fixture.${actor}.seen`,
              JSON.stringify(seen),
            );
            localStorage.setItem("cosyworld.dialogue.sound", "off");
            localStorage.setItem(
              "cosyworld.room-music",
              JSON.stringify({ enabled: false, volume: 0 }),
            );
          },
          { actor, seen },
        );
        await context.route("**/auth/account", (route) =>
          route.fulfill({ json: { authenticated: true } }),
        );
        await context.route(
          "**/card-game/shared/worlds/ship-fixture{,/command}",
          async (route) => {
            const command =
              route.request().method() === "POST"
                ? route.request().postDataJSON()
                : null;
            if (command?.op === "play") {
              const result = dispatchShared({
                world,
                actor,
                op: "play",
                action: command.action,
                claimed: players,
                present: players,
              });
              if (!result.ok)
                return route.fulfill({ status: 409, json: result });
              world = result.world;
            }
            const view = dispatchShared({
              world,
              actor,
              op: "view",
              claimed: players,
              present: players,
            });
            await route.fulfill({
              json: {
                ...view,
                id: "ship-fixture",
                actor,
                now: Date.now(),
                claimed: [1, 1, 1, 0, 0, 0, 0, 0],
                present: [1, 1, 1, 0, 0, 0, 0, 0],
                history: [],
                queue: [],
              },
            });
          },
        );
        const page = await context.newPage();
        pages.push(page);
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${origin}/?world=ship-fixture`);
        await page
          .locator('#hand [data-card="greek-ship"]')
          .waitFor({ state: "attached" });
      }
      const [vale, mara, ash] = pages;
      async function move(page, actor, target) {
        await page.waitForFunction(
          ({ place, turn }) => {
            const hand = document.querySelector("#hand");
            return (
              document.body.dataset.place === place &&
              hand?.dataset.presentedTurn === String(turn) &&
              hand.dataset.cooling === "false" &&
              hand.getAttribute("aria-busy") === "false"
            );
          },
          { place: world.actors[actor].place, turn: world.turn },
        );
        // A shared update can repaint the hand while another player boards.
        // The locator click follows the current card through that repaint.
        await page.keyboard.press("Escape");
        await selectCard(page, target);
        await page
          .getByRole("button", {
            name: target === "greek-ship" ? "Board" : "Disembark",
            exact: true,
          })
          .click();
        await page.waitForFunction(
          (place) => document.body.dataset.place === place,
          target,
        );
        assert.equal(world.actors[actor].place, target);
      }
      await move(vale, "vale", "greek-ship");
      assert.equal(world.transports["greek-ship"].dock, "pond");
      await mara
        .locator('#hand [data-card="greek-ship"]')
        .waitFor({ state: "attached" });
      await mara.waitForFunction(
        () => document.querySelector("#location-overlay")?.hidden === false,
      );
      await mara.screenshot({
        path: new URL(`boarding-${width}.png`, output).pathname,
      });
      await move(mara, "mara", "greek-ship");
      await move(vale, "vale", "greek-harbor");
      assert.equal(world.transports["greek-ship"].dock, "greek-harbor");
      await ash
        .locator('#hand [data-card="greek-ship"]')
        .waitFor({ state: "detached" });
      await ash.waitForFunction(
        () =>
          !document.querySelector("#location-overlay") ||
          document.querySelector("#location-overlay").hidden,
      );
      await mara
        .locator('#hand [data-card="greek-harbor"]')
        .waitFor({ state: "attached" });
      await move(vale, "vale", "greek-ship");
      assert.equal(world.actors.mara.place, "greek-ship");
      await mara
        .locator('#hand [data-card="pond"]')
        .waitFor({ state: "attached" });
      await move(vale, "vale", "pond");
      await ash
        .locator('#hand [data-card="greek-ship"]')
        .waitFor({ state: "attached" });
      await move(ash, "ash", "greek-ship");
      await move(ash, "ash", "greek-harbor");
      await move(mara, "mara", "greek-harbor");
      await mara.screenshot({
        path: new URL(`arrival-${width}.png`, output).pathname,
      });
      assert.equal(world.actors.vale.place, "pond");
      assert.equal(world.transports["greek-ship"].destination, null);
      assert.deepEqual(errors, []);
    } finally {
      for (const context of contexts) await context.close();
    }
  }
  console.log(
    "Shared ship: three players, both shores, a returning rider, desktop and phone passed.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
