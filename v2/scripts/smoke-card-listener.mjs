import assert from "node:assert/strict";
import { chromium } from "playwright";
import { TAP_GUARD_MS } from "../card-game/card-travel.mjs";
import { profiles } from "../card-game/memory.mjs";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import {
  actionLabel,
  readyActionButton,
  selectCard,
} from "./card-browser-helpers.mjs";

function calledWorld() {
  const world = createWorld({ seed: 5 });
  world.actors.vale.place = "pond";
  world.actors.vale.visited.push("pond");
  world.actors.vale.arcana = { proved: [], did: [], calls: 3 };
  return world;
}
const words = {
  vale: "What have you heard?",
  listener: "Water holds a reflection only while you stand still.",
};
const read = (page, text) =>
  page.waitForFunction(
    (text) =>
      document.querySelector("#dialogue-text").textContent.includes(text),
    text,
  );
const questFold = (page) => page.locator("#hand .quest-fold:not([data-owner])");
const tarotCard = (page, face) =>
  page.locator(`#hand .want-card[data-face="${face}"]`);

async function waitingForReading(page) {
  assert.equal(
    await questFold(page).count(),
    0,
    "the reading still holds the dealt card back",
  );
  assert.equal(await tarotCard(page, "down").count(), 0);
  assert.equal(await tarotCard(page, "reward").count(), 0);
}

async function turnAndCollect(page, touch = false) {
  const held = tarotCard(page, "down");
  await held.waitFor();
  const preview = page.locator('#action-beat [data-kind="arcanum"] > img');
  await preview.waitFor();
  const back = await held.locator(".card-back").getAttribute("src");
  assert.match(back, /tarot-back-locked/u);
  assert.equal(await preview.getAttribute("src"), back);
  await preview.evaluate((img) => img.decode());

  const button = readyActionButton(page, "accept");
  const press = async () => {
    await page.waitForTimeout(TAP_GUARD_MS);
    return touch ? button.tap() : button.click();
  };
  await button.waitFor();
  assert.equal(await actionLabel(button), "Turn over");
  await press();
  const reward = tarotCard(page, "reward");
  await reward.waitFor();
  const art = reward.locator(".art > img");
  assert.match(await art.getAttribute("src"), /arcanum-0/u);
  await art.evaluate((img) => img.decode());
  await button.waitFor();
  assert.equal(await actionLabel(button), "Collect");
  await press();
  await reward.waitFor({ state: "detached" });
}

async function checkShared(browser, origin) {
  const id = "listener-shared";
  let { world } = dispatchShared({
    op: "create",
    save: encodeSave(calledWorld()),
  });
  let playId,
    history = [];
  const request = (op, extra) =>
    dispatchShared({
      world,
      op,
      actor: "vale",
      claimed: ["vale"],
      present: ["vale"],
      ...extra,
    });
  const page = await browser.newPage({ reducedMotion: "reduce" });
  page.setDefaultTimeout(15000);
  await page.addInitScript(
    ({ id, seen }) => {
      localStorage.setItem(
        `cosyworld.reflected-shore.v1.shared.${id}.vale.seen`,
        JSON.stringify(seen),
      );
      localStorage.setItem("cosyworld.dialogue.sound", "off");
    },
    { id, seen: Object.keys(profiles) },
  );
  await page.route("**/auth/account", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        user_id: "listener-test",
        account_revision: 0,
      },
    }),
  );
  await page.route(
    new RegExp(`/card-game/shared/worlds/${id}(?:/command)?$`),
    (route) => {
      const command = route.request().postDataJSON();
      if (command?.op === "play") {
        const played = request("play", { action: command.action });
        assert(played.ok, played.error);
        world = played.world;
        playId = command.key;
      }
      return route.fulfill({
        json: {
          id,
          actor: "vale",
          world,
          now: Date.now(),
          actions: request("view").actions,
          claimed: [true],
          present: [true],
          history,
          queue:
            playId && !history.length
              ? [{ id: playId, actor: "vale", status: "working" }]
              : [],
        },
      });
    },
  );
  await page.goto(`${origin}/?world=${id}`);
  await selectCard(page, "listener");
  await readyActionButton(page, "talk").click();
  await page.locator('#speech-row[data-beat="pending"]').waitFor();
  await waitingForReading(page);
  const speech = request("speech", {
    room: "pond",
    lines: Object.entries(words).map(([actorId, text]) => ({ actorId, text })),
  });
  world = speech.world;
  history = [
    {
      play: playId,
      actor: "vale",
      room: "pond",
      starts_at: Date.now(),
      lines: speech.lines,
    },
  ];
  await read(page, words.vale);
  await waitingForReading(page);
  await page.locator("#dialogue-advance").click();
  await read(page, words.listener);
  await turnAndCollect(page);
  assert(world.actors.vale.upgrades.includes("arcanum-0"));
  await page.close();
}

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const world = calledWorld();
    const table = `listener-${width}`;
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    page.setDefaultTimeout(15000);
    await page.addInitScript(
      ({ key, save }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, save);
        localStorage.setItem("cosyworld.dialogue.sound", "off");
      },
      { key: `cosyworld.reflected-shore.v1.${table}`, save: encodeSave(world) },
    );
    const response = Promise.withResolvers();
    let requests = 0;
    await page.route("**/card-game/text", async (route) => {
      if (++requests === 1 && width === 390) return;
      await response.promise;
      await route.fulfill({
        json: {
          revision: route.request().postDataJSON().revision,
          model: "listener-fixture",
          entries: Object.entries(words).map(([id, text]) => ({ id, text })),
        },
      });
    });
    await page.goto(`${origin}/?table=${table}`);
    await selectCard(page, "listener", { touch: width === 390 });
    const request = page.waitForRequest("**/card-game/text");
    await readyActionButton(page, "talk").click();
    const input = (await request).postDataJSON();
    assert.deepEqual(input.speakers, ["vale", "listener"]);
    assert.match(
      input.events.join(" "),
      /reading before handing over a face-down card/u,
    );
    await page.locator('#speech-row[data-beat="pending"]').waitFor();
    await page.locator('#cast [data-avatar="listener"]').waitFor();
    await waitingForReading(page);
    if (width === 390) {
      const resumed = page.waitForRequest("**/card-game/text");
      await page.reload();
      assert.deepEqual((await resumed).postDataJSON().speakers, input.speakers);
      await page.locator('#speech-row[data-beat="pending"]').waitFor();
      await waitingForReading(page);
    }
    const mobileHandoff =
      width === 390 &&
      page.waitForFunction(
        () =>
          document.querySelector('#hand .want-card[data-face="down"]') && {
            line: document.querySelector("#dialogue-text").textContent,
          },
      );
    response.resolve();
    await read(page, words.vale);
    await waitingForReading(page);
    const advance = page.locator("#dialogue-advance");
    const continueReading = () =>
      width === 390 ? advance.tap() : advance.click();
    await continueReading();
    await read(page, words.listener);
    assert.equal(
      await page.locator("#speaker-portrait").getAttribute("data-entity"),
      "listener",
    );
    if (mobileHandoff) {
      const { line } = await (await mobileHandoff).jsonValue();
      assert.equal(
        line,
        words.listener,
        "the resumed Listener line is readable before the deal",
      );
    } else {
      await waitingForReading(page);
      await continueReading();
    }
    await turnAndCollect(page, width === 390);
    await page.close();
  }
  await checkShared(browser, origin);
  console.log(
    "The Listener finishes the reading before the first Fool can be turned and collected on desktop, mobile, and a shared table.",
  );
} finally {
  await browser.close();
  server.close();
}
