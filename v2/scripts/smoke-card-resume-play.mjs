import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import {
  createWorld,
  legalActions,
  addLog,
  holdChoice,
} from "../card-game/world.mjs";
import { availableCards } from "../card-game/cards.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const app = await readFile(
  new URL("../card-game/app.mjs", import.meta.url),
  "utf8",
);
try {
  for (const [width, held] of [1440, 390].flatMap((width) =>
    [null, "lamp"].map((held) => [width, held]),
  )) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const world = createWorld();
    world.playerActorId = "vale";
    world.sharedVersion = 1;
    world.controlledActors = ["vale"];
    world.presentActors = ["vale"];
    world.actors.vale.place = "pond";
    world.items.lamp.holder = "vale";
    holdChoice(world, "vale", { item: held, revision: world.revision });
    addLog(world, "Vale", "The current play continues.", {
      generated: true,
      kind: "dialogue",
      actorId: "vale",
      locationId: "pond",
    });
    const line = world.log.at(-1);
    const state = {
      actor: "vale",
      world,
      actions: legalActions(world),
      now: Date.now(),
      queue: [],
      history: [
        {
          play: "existing",
          room: "pond",
          starts_at: Date.now() - 1,
          until_at: Date.now() + 60000,
          lines: [line],
        },
      ],
      claimed: [true],
      present: [true],
    };
    let submissions = 0;
    await page.addInitScript(
      ({ seen }) => {
        localStorage.setItem(
          "cosyworld.reflected-shore.v1.shared.resume-play.vale.seen",
          JSON.stringify(seen),
        );
        localStorage.setItem("cosyworld.dialogue.sound", "off");
        localStorage.setItem(
          "cosyworld.room-music",
          JSON.stringify({ enabled: false }),
        );
      },
      { seen: availableCards(world) },
    );
    await page.route("**/app.mjs", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body:
          app +
          `\nglobalThis.tryStalePlay = () => submitSharedPlay(legalActions(world).find(a => a.kind === "wait"));
      globalThis.resumeStatus = () => ({ sharedPlay, sharedRefusal, reviewing,
        queue: sharedSession.state.queue, revision: world.revision, selected, lamp: world.items.lamp, held: world.actors.vale.heldItem });\n`,
      }),
    );
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.route("**/card-game/shared/worlds/resume-play**", (route) => {
      const body = route.request().postDataJSON();
      if (body?.op === "play") {
        submissions++;
        state.now++;
        state.queue = [{ id: "existing", actor: "vale", status: "working" }];
        return route.fulfill({
          status: 409,
          json: { error: "Your play is already at the table." },
        });
      }
      return route.fulfill({ json: state });
    });
    await page.goto(`${origin}/?world=resume-play`);
    await page.waitForFunction(
      () => typeof globalThis.tryStalePlay === "function",
    );
    await page.evaluate(() => globalThis.tryStalePlay());
    const result = await page.evaluate(() => globalThis.resumeStatus());
    assert.equal(submissions, 1);
    assert.equal(result.sharedPlay, null);
    assert.equal(result.sharedRefusal, null);
    assert.equal(result.reviewing, false);
    assert.equal(result.queue[0].id, "existing");
    assert.equal(result.revision, world.revision);
    assert.deepEqual(result.selected, held ? [held] : []);
    assert.equal(result.held, held);
    assert.deepEqual(result.lamp, world.items.lamp);
    assert.equal(await page.locator("#play-status").isVisible(), false);
    await page.waitForFunction(() =>
      document
        .querySelector("#dialogue-text")
        .textContent.includes("The current play continues."),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Current play resumes with lamp ${held ? "held" : "stowed"} at ${width}px without another submission or refusal.`,
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
