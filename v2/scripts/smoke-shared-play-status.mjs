// The player's own shared play says whether it is queued, sent, played or refused.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const output = resolve("output/shared-play-status");
await mkdir(output, { recursive: true });
const refusal = "That play has changed. Check the cards and choose again.";

async function check(width) {
  let world = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  let queue = [],
    history = [],
    notice = null;
  const keys = [],
    cancels = [],
    errors = [];
  const view = () => ({
    ...dispatchShared({
      op: "view",
      world,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
    }),
    id: "status",
    version: "full-card-world/9",
    claimed: [1, 0, 0, 0, 0, 0, 0, 0],
    present: [1, 0, 0, 0, 0, 0, 0, 0],
    now: Date.now(),
    queue,
    history,
    notice,
  });
  // Commit the queued play the way the round worker does.
  const commit = () => {
    const played = dispatchShared({
      op: "play",
      world,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
      action: queue[0].action,
    });
    assert(played.ok);
    world = played.world;
    history = [{ play: queue[0].id, room: "station", lines: [] }];
    queue = [];
  };
  const page = await browser.newPage({
    viewport: { width, height: width === 390 ? 844 : 900 },
    reducedMotion: "reduce",
    isMobile: width === 390,
    hasTouch: width === 390,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route(
    /\/card-game\/shared\/worlds\/status(?:\/command)?$/,
    async (route) => {
      const body = route.request().postDataJSON();
      if (body?.op === "play") {
        keys.push(body.key);
        queue = [
          {
            id: body.key,
            actor: "vale",
            status: "waiting",
            action: body.action,
          },
        ];
      } else if (body?.op === "cancel") {
        cancels.push(body.key);
        queue = queue.filter((entry) => entry.id !== body.key);
      }
      await route.fulfill({
        json: {
          ...view(),
          queue: queue.map(({ action, ...entry }) => entry),
        },
      });
    },
  );
  const status = () =>
    page.locator("#notice").evaluate((element) => ({
      text: element.hidden ? "" : element.textContent,
      state: element.dataset.playStatus,
    }));
  const waitFor = (text) =>
    page.waitForFunction(
      (text) =>
        text === ""
          ? document.querySelector("#notice").hidden
          : document.querySelector("#notice").textContent === text,
      text,
    );
  const wait = page.locator('#card-actions [data-action="wait"]');
  const cancel = page.locator("#card-actions [data-cancel-play]");
  // A sent play leaves the hand; selecting Vale again shows its pill.
  const chooseWait = async () => {
    if (!(await wait.isVisible()))
      await selectCard(page, "vale", { touch: width === 390 });
    await wait.waitFor();
  };
  try {
    await page.goto(`${origin}/?world=status`);
    await page.waitForFunction(() => document.body.inert === false);

    // Queued for the round, then playing, then committed.
    await chooseWait();
    await wait.click();
    await waitFor("Sent: Wait. Waiting for the round.");
    assert.equal((await status()).state, "sent");
    assert.equal(await cancel.isVisible(), true);
    await chooseWait();
    assert.equal(await wait.innerText(), "Sent: Wait");
    // A second choice waits for the first; it cancels with its own control.
    await wait.click();
    await waitFor("Queued: Wait. Waiting for your earlier play.");
    assert.equal(await wait.innerText(), "Queued: Wait");
    await page.waitForTimeout(400);
    assert.equal(keys.length, 1);
    await cancel.click();
    await waitFor("Sent: Wait. Waiting for the round.");
    assert.equal(await wait.innerText(), "Sent: Wait");
    assert.deepEqual(cancels, []);
    assert.equal(queue.length, 1);
    await page.screenshot({
      path: resolve(output, `sent-${width}.png`),
    });
    queue[0].status = "working";
    await waitFor("Playing: Wait.");
    commit();
    await waitFor("Played: Wait.");
    assert.equal((await status()).state, "played");
    await waitFor("");
    assert.equal(world.turn, 1);

    // A refused play names its reason and stays until the next play.
    await chooseWait();
    await wait.click();
    await waitFor("Sent: Wait. Waiting for the round.");
    queue = [];
    notice = refusal;
    await waitFor(`Not played: Wait. ${refusal}`);
    assert.equal((await status()).state, "rejected");
    await page.waitForTimeout(2200);
    assert.equal((await status()).text, `Not played: Wait. ${refusal}`);
    await page.screenshot({
      path: resolve(output, `refused-${width}.png`),
    });
    await chooseWait();
    await wait.click();
    await waitFor("Sent: Wait. Waiting for the round.");

    // The visible control withdraws the queued play.
    await cancel.click();
    await waitFor("");
    assert.deepEqual(cancels, [keys.at(-1)]);
    await page.waitForFunction(
      () => !document.querySelector("#card-actions [data-cancel-play]"),
    );

    // A reload does not bring back the old refusal.
    await page.reload();
    await page.waitForFunction(() => document.body.inert === false);
    await page.waitForTimeout(2200);
    assert.equal((await status()).text, "");
    assert.deepEqual(errors, []);
    console.log(`Shared play status passed at ${width}px.`);
  } finally {
    await page.close();
  }
}

try {
  for (const width of [1440, 390]) await check(width);
} finally {
  await browser.close();
  server.close();
}
