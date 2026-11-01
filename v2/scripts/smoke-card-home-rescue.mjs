import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  encodeSave,
  places,
  things,
  people,
} from "../card-game/world.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { humanAvatarIds } from "../card-game/human-cast.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
await mkdir("output/home-rescue", { recursive: true });
async function ready(page) {
  await page.waitForFunction(() => document.body.inert === false);
  while (await page.locator("#unveil-dialog[open]").count()) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
  }
}
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    const opening = createWorld({ opening: true });
    opening.actors.vale.place = "attic";
    opening.items.lamp.holder = "attic";
    opening.items.lamp.fuel = 0;
    // The opening starts lit (#1653); a dry lamp cannot stay lit.
    opening.items.lamp.lit = false;
    const seen = [
      ...Object.keys(places),
      ...Object.keys(things),
      ...Object.keys(people),
    ];
    await context.addInitScript(
      ({ save, seen }) => {
        if (!localStorage.getItem("cosyworld.reflected-shore.v1.home-rescue"))
          localStorage.setItem(
            "cosyworld.reflected-shore.v1.home-rescue",
            save,
          );
        for (const slot of ["home-rescue", "shared.rescue.ash"])
          localStorage.setItem(
            `cosyworld.reflected-shore.v1.${slot}.seen`,
            JSON.stringify(seen),
          );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      },
      { save: encodeSave(opening), seen },
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/card-game/text", (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Story service paused for local check." },
      }),
    );
    await page.goto(`${origin}/?table=home-rescue`);
    await ready(page);
    assert.equal(await page.locator('#hand [data-card="station"]').count(), 0);
    await selectCard(page, "pond", { touch: width === 390 });
    assert.match(
      await page.locator("#card-actions").innerText(),
      /Go|Travel|Move/,
    );
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#backdrop").src.includes("pond"),
    );
    await ready(page);
    await page.reload();
    await ready(page);
    assert(
      (await page.locator("#backdrop").getAttribute("src")).includes("pond"),
    );

    await selectCard(page, "station", { touch: width === 390 });
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#backdrop").src.includes("station"),
    );
    await ready(page);

    let world = dispatchShared({
      op: "create",
      save: encodeSave(createWorld()),
    }).world;
    world.actors.vale.place = "belfry";
    const present = ["vale", "ash"];
    const project = () =>
      dispatchShared({
        op: "view",
        world,
        actor: "ash",
        claimed: humanAvatarIds,
        present,
      });
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.route(
      /\/card-game\/shared\/worlds\/rescue(?:\/command)?$/,
      (route) => {
        const command = route.request().postDataJSON();
        if (command?.op === "play") {
          const result = dispatchShared({
            ...command,
            world,
            actor: "ash",
            claimed: humanAvatarIds,
            present,
          });
          assert(result.ok, result.error);
          world = result.world;
        }
        return route.fulfill({
          json: {
            ...project(),
            id: "rescue",
            claimed: humanAvatarIds.map(() => 1),
            present: humanAvatarIds.map((id) => Number(present.includes(id))),
            now: Date.now(),
            history: [],
            queue: [],
            music_started: false,
          },
        });
      },
    );
    await page.goto(`${origin}/?world=rescue`);
    await ready(page);
    assert.equal(await page.locator('#hand [data-card="station"]').count(), 0);
    for (const [kind, target] of [
      ["take", null],
      ["move", "pond"],
    ]) {
      const view = dispatchShared({
        op: "view",
        world,
        actor: "vale",
        claimed: humanAvatarIds,
        present,
      });
      const action = view.actions.find(
        (a) =>
          a.kind === kind &&
          (kind === "take" ? a.item === "float" : a.target === target),
      );
      assert(action);
      const result = dispatchShared({
        op: "play",
        world,
        actor: "vale",
        claimed: humanAvatarIds,
        present,
        action,
      });
      assert(result.ok, result.error);
      world = result.world;
      if (kind === "take") assert.deepEqual(project().exits, ["pond"]);
    }
    // The pond joins the location stack face down (#1780).
    await page
      .locator('#hand [data-card="pond"]')
      .waitFor({ state: "attached" });
    await ready(page);
    await selectCard(page, "pond", { touch: width === 390 });
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#backdrop").src.includes("pond"),
    );
    await ready(page);
    await selectCard(page, "station", { touch: width === 390 });
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#backdrop").src.includes("station"),
    );
    assert.equal(world.actors.ash.place, "station");
    await page.screenshot({ path: `output/home-rescue/station-${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `Home rescue: dry attic lamp, saved pond rescue, shared helper departure, and Ash pond-to-station travel passed at ${width}px.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
