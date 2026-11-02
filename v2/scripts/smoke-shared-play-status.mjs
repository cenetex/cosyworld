// The player's own shared play shows on its button while sent. Once it
// commits the action beat leaves and the reply types into the full-size
// front card. A refusal names its reason on the action bar's status line.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { addLog, createWorld, encodeSave } from "../card-game/world.mjs";
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
  // Nothing floats over the stage: a pending play reads on its button, and
  // only a refusal takes the action bar's status line.
  const status = () =>
    page.locator("#play-status").evaluate((element) => ({
      text: element.hidden ? "" : element.textContent,
      state: element.dataset.playStatus,
    }));
  const waitFor = (text) =>
    page.waitForFunction(
      (text) =>
        text === ""
          ? document.querySelector("#play-status").hidden
          : document.querySelector("#play-status").textContent === text,
      text,
    );
  const wait = page.locator('#card-actions [data-action="wait"]');
  const cancel = page.locator("#card-actions [data-cancel-play]");
  const sent = (state) =>
    page.waitForFunction(
      (state) =>
        document.querySelector('#card-actions [data-action="wait"]')?.dataset
          .sent === state,
      state,
    );
  // A sent play leaves the hand; selecting Vale again shows its pill.
  const chooseWait = async () => {
    // A committed play rests the beat with Vale still chosen: tapping him
    // again lets go, and the next tap chooses him.
    if (
      !(await wait.isVisible()) &&
      (await page
        .locator('#hand [data-card="vale"]')
        .getAttribute("aria-pressed")) === "true"
    )
      await selectCard(page, "vale", { touch: width === 390 });
    if (!(await wait.isVisible()))
      await selectCard(page, "vale", { touch: width === 390 });
    await wait.waitFor();
  };
  try {
    await page.goto(`${origin}/?world=status`);
    await page.waitForFunction(() => document.body.inert === false);
    assert.equal(await page.locator("#notice").count(), 0, "no notice box");

    // Sent for the round, then playing, then committed.
    await chooseWait();
    await wait.click();
    await cancel.waitFor();
    await chooseWait();
    await sent("sent");
    assert.equal(await wait.innerText(), "Waiting…");
    assert.equal((await status()).text, "");
    // A second choice waits for the first; it cancels with its own control.
    await wait.click();
    assert.equal(await wait.innerText(), "Waiting…");
    await page.waitForTimeout(400);
    assert.equal(keys.length, 1);
    await cancel.click();
    await sent("sent");
    assert.equal(await wait.innerText(), "Waiting…");
    assert.deepEqual(cancels, []);
    assert.equal(queue.length, 1);
    await page.screenshot({
      path: resolve(output, `sent-${width}.png`),
    });
    // Committed: the beat leaves while the reply is written.
    queue[0].status = "working";
    await page.waitForFunction(
      () => document.querySelector(".action-panel").hidden,
    );
    assert.equal((await status()).text, "");
    // The reply types into the full-size front card while the scene plays,
    // and nothing steps back in time without input.
    const key = queue[0].id;
    commit();
    const reply =
      "The lamp hums while I wait here with you, as long as it takes.";
    addLog(world, "Vale", reply, {
      generated: true,
      kind: "dialogue",
      actorId: "vale",
      entityId: "vale",
      locationId: "station",
    });
    const startsAt = Date.now();
    history = [
      {
        play: key,
        room: "station",
        actor: "vale",
        turn: world.turn,
        starts_at: startsAt,
        until_at: startsAt + 30000,
        lines: [world.log.at(-1)],
      },
    ];
    queue = [{ id: key, actor: "vale", status: "playing" }];
    await page.waitForFunction(
      (reply) =>
        document.querySelector("#dialogue-text")?.textContent.includes(reply),
      reply,
    );
    const front = () =>
      page.evaluate(() => ({
        panel: document.querySelector(".action-panel").hidden,
        action: document.querySelector(".beat-stack").dataset.action,
        position: getComputedStyle(document.querySelector("#speech-row"))
          .position,
        opacity: getComputedStyle(document.querySelector("#speech-row"))
          .opacity,
        live: document.querySelector("#live-line").hidden,
      }));
    const shown = await front();
    assert.notEqual(shown.position, "absolute", "not squashed into a strip");
    assert.deepEqual(
      { ...shown, position: undefined },
      {
        panel: true,
        action: "false",
        position: undefined,
        opacity: "1",
        live: true,
      },
    );
    await page.screenshot({ path: resolve(output, `playing-${width}.png`) });
    await page.waitForTimeout(1500);
    assert.equal((await front()).live, true, "no step back without input");
    // The scene has been read; the next play need not wait for it.
    queue = [];
    history = [{ play: key, room: "station", lines: [] }];
    await page.waitForFunction(
      () => !document.querySelector("#card-actions [data-sent]"),
    );
    assert.equal((await status()).text, "");
    assert.equal(world.turn, 1);

    // A refused play names its reason and stays until the next play.
    await chooseWait();
    const sentBefore = keys.length;
    await wait.click();
    await cancel.waitFor();
    // The play waits for the read scene to settle before it is sent.
    while (keys.length === sentBefore || !queue.length)
      await page.waitForTimeout(50);
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
    await waitFor("");

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
