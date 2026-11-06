// The player's own shared play is one Thinking card while it waits, which
// cancels in two taps. Once it commits the reply types into the full-size
// front card. A refused play says why on its own button while its cards stay
// chosen (#2026), or briefly on the status line once they are not, and the
// action beat fits a phone at 390x844, 320x568 and 200% text.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { addLog, createWorld, encodeSave } from "../card-game/world.mjs";
import { readyActionButton, selectCard } from "./card-browser-helpers.mjs";

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
  let served = 0;
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
  await page.addInitScript(() =>
    localStorage.setItem(
      "cosyworld.reflected-shore.v1.shared.status.vale.seen",
      JSON.stringify(["vale", "station"]),
    ),
  );
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
      served++;
      await route.fulfill({
        json: {
          ...view(),
          queue: queue.map(({ action, ...entry }) => entry),
        },
      });
    },
  );
  // Nothing floats over the stage: only a refusal takes the action bar's
  // status line.
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
  const thinkingIs = (text) =>
    page.waitForFunction((text) => {
      const label = document.querySelector("#story-status");
      return (label.hidden ? "" : label.textContent.trim()) === text;
    }, text);
  const tapCard = () =>
    width === 390
      ? page.locator("#speech-row").tap()
      : page.locator("#speech-row").click();
  const twoTaps = async () => {
    await thinkingIs("Thinking…");
    await tapCard();
    await thinkingIs("Tap again to cancel");
    await tapCard();
  };
  const until = async (done) => {
    for (let i = 0; i < 200 && !done(); i++) await page.waitForTimeout(50);
    assert(done());
  };
  // The page has polled the table since the fixture changed.
  const seenByPage = async () => {
    const seen = served;
    await until(() => served > seen + 1);
  };
  // A sent play leaves the hand; selecting Vale again shows its pill.
  const chooseWait = async () => {
    // A play rests the beat with Vale still chosen: tapping him again lets
    // go, and the next tap chooses him.
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
    // Vale again after a Wait offers Sleep; letting go brings back Wait.
    if ((await wait.getAttribute("aria-label")) === "Sleep") {
      await selectCard(page, "vale", { touch: width === 390 });
      await selectCard(page, "vale", { touch: width === 390 });
    }
    await readyActionButton(page, "wait").waitFor();
    assert.equal(await wait.getAttribute("aria-label"), "Wait");
  };
  try {
    await page.goto(`${origin}/?world=status`);
    await page.waitForFunction(() => document.body.inert === false);
    assert.equal(await page.locator("#notice").count(), 0, "no notice box");

    // Waiting at the table: one Thinking card, the speaker's, no button.
    await chooseWait();
    await wait.click();
    await until(() => queue.length === 1);
    await seenByPage();
    await thinkingIs("Thinking…");
    assert.equal(await page.locator("#speaker").innerText(), "Vale");
    assert(await page.locator(".action-panel").isHidden());
    assert.equal((await status()).text, "");
    await page.screenshot({ path: resolve(output, `thinking-${width}.png`) });
    // The first tap asks; a pause, Escape or a tap elsewhere puts it back.
    await tapCard();
    await thinkingIs("Tap again to cancel");
    await page.screenshot({ path: resolve(output, `confirm-${width}.png`) });
    await thinkingIs("Thinking…");
    await tapCard();
    await thinkingIs("Tap again to cancel");
    await page.keyboard.press("Escape");
    await thinkingIs("Thinking…");
    await tapCard();
    await thinkingIs("Tap again to cancel");
    await page.mouse.click(width / 2, 120);
    await thinkingIs("Thinking…");
    assert.deepEqual(cancels, []);
    assert.equal(queue.length, 1);
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
    assert.equal((await status()).text, "");
    assert.equal(world.turn, 1);

    // A play refused at the table after its cards were let go says so
    // briefly, and stays until the next choice.
    await chooseWait();
    const sentBefore = keys.length;
    await wait.click();
    // The play waits for the read scene to settle before it is sent.
    await until(() => keys.length > sentBefore && queue.length > 0);
    queue = [];
    notice = refusal;
    const aside = "Not played: Wait. That play has changed.";
    await waitFor(aside);
    assert.equal((await status()).state, "rejected");
    await page.waitForTimeout(2200);
    assert.equal((await status()).text, aside);
    await page.screenshot({
      path: resolve(output, `refused-${width}.png`),
    });
    await chooseWait();
    await wait.click();
    await waitFor("");

    // Two taps withdraw a waiting play.
    await until(() => queue.length === 1);
    await seenByPage();
    await twoTaps();
    await until(() => cancels.length === 1);
    assert.deepEqual(cancels, [keys.at(-1)]);
    await thinkingIs("");

    // A resuming play is committed: cancelling stops waiting for its line,
    // keeps the play and shows its caption with no line or error.
    await chooseWait();
    await wait.click();
    await until(() => queue.length === 1);
    const retried = queue[0].id;
    // The residents stay content, so Vale's caption is the newest beat.
    world.actors.moth.want = null;
    world.actors.keeper.want = null;
    commit();
    queue = [{ id: retried, actor: "vale", status: "retry" }];
    history = [
      {
        play: retried,
        room: "station",
        actor: "vale",
        turn: world.turn,
        lines: [],
      },
    ];
    await seenByPage();
    await twoTaps();
    await until(() => cancels.length === 2);
    history[0].error = "The story service needs a little more time.";
    await thinkingIs("");
    await page.waitForTimeout(600);
    // The committed play's effect is inscribed on the card in front.
    assert.match(await page.locator("#beat-captions").innerText(), /waited/);
    assert.equal(await page.locator("#story-retry, #story-error").count(), 0);
    const text = await page.locator("body").innerText();
    assert.doesNotMatch(text, /undone|withdrawn|cancelled/i);
    assert.equal(world.turn, 2);

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

// The rules refuse a play outright: its button reads the reason, disabled,
// and nothing in the action beat spills out of it.
async function checkRefusalFits(width, height, zoom = 1) {
  const seat = { claimed: ["vale"], present: ["vale"] };
  let world = dispatchShared({ op: "create", seed: 7 }).world;
  world = dispatchShared({
    world,
    op: "join",
    actor: "vale",
    ...seat,
    progress: { upgrades: ["scarf"] },
  }).world;
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: zoom,
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
  });
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route(
    /\/card-game\/shared\/worlds\/fits(?:\/command)?$/,
    (route) =>
      route.request().postDataJSON()?.op === "play"
        ? route.fulfill({
            status: 422,
            json: { error: "This save needs a fresh start. (validateWorld:1)" },
          })
        : route.fulfill({
            json: {
              ...dispatchShared({ op: "view", world, actor: "vale", ...seat }),
              id: "fits",
              version: "full-card-world/96",
              claimed: [1, 0, 0, 0, 0, 0, 0, 0],
              present: [1, 0, 0, 0, 0, 0, 0, 0],
              now: Date.now(),
              queue: [],
              history: [],
              notice: null,
            },
          }),
  );
  try {
    await page.goto(`${origin}/?world=fits`);
    await page.waitForFunction(() => document.body.inert === false);
    await selectCard(page, "forest-cottage", { touch: true });
    const primary = readyActionButton(page);
    await primary.waitFor();
    assert.equal(
      await primary.getAttribute("aria-label"),
      "Down to the cottage",
    );
    await primary.tap();
    await page.waitForFunction(() =>
      document.querySelector("#card-actions [data-blocked=refused]"),
    );
    const beat = await page.evaluate(() => {
      const panel = document
        .querySelector(".action-panel")
        .getBoundingClientRect();
      const spills = [
        ...document.querySelectorAll(
          ".action-beat-body > :not([hidden]), #card-actions button",
        ),
      ].filter((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.top < panel.top - 1 ||
          box.bottom > panel.bottom + 1 ||
          box.left < panel.left - 1 ||
          box.right > panel.right + 1 ||
          el.scrollHeight > el.clientHeight + 1 ||
          el.scrollWidth > el.clientWidth + 1
        );
      });
      const button = document.querySelector("#card-actions .card-primary");
      // The beat says each thing once: the play's name is not repeated
      // beside a button that already names it or its reason.
      const said = document.querySelector(".action-panel").innerText;
      const once = (text) => said.split(text).length - 1;
      return {
        label: button.textContent,
        disabled: button.disabled,
        status: document.querySelector("#play-status").hidden,
        spills: spills.map((el) => el.className || el.id),
        inView: panel.left >= 0 && panel.right <= innerWidth,
        repeats: ["Down to the cottage", "Waiting for an update"].filter(
          (text) => once(text) > 1,
        ),
        update: once("This world is waiting"),
      };
    });
    await page.screenshot({
      path: resolve(output, `refused-fits-${width}x${height}@${zoom}.png`),
    });
    assert.deepEqual(beat, {
      label: "Waiting for an update",
      disabled: true,
      status: true,
      spills: [],
      inView: true,
      repeats: [],
      update: 0,
    });
    console.log(`A refused play fits at ${width}x${height}@${zoom}x.`);
  } finally {
    await page.close();
  }
}

try {
  for (const width of [1440, 390]) await check(width);
  // 195x422 at 2x is 390x844 at 200% text.
  for (const [width, height, zoom] of [
    [390, 844, 1],
    [320, 568, 1],
    [195, 422, 2],
  ])
    await checkRefusalFits(width, height, zoom);
} finally {
  await browser.close();
  server.close();
}
