import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { selectCard } from "./card-browser-helpers.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
async function checkPlayRecovery(width, scenario) {
  let world = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  const history = [],
    keys = [],
    errors = [];
  let releasePolls = false;
  const otherNotice = "Mara would like your attention.";
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.route(
    /\/card-game\/shared\/worlds\/recovery(?:\/command)?$/,
    async (route) => {
      const body = route.request().postDataJSON();
      if (body?.op === "play") {
        keys.push(body.key);
        if (scenario === "validation")
          return route.fulfill({
            status: 409,
            json: { error: "Choose a current play." },
          });
        {
          const actor = scenario === "unaccepted" ? "mara" : "vale";
          const action =
            scenario === "unaccepted"
              ? dispatchShared({
                  op: "view",
                  world,
                  actor,
                  claimed: ["vale", "mara"],
                  present: ["vale", "mara"],
                }).actions.find((a) => a.kind === "wait")
              : body.action;
          const played = dispatchShared({
            op: "play",
            world,
            actor,
            claimed: ["vale", "mara"],
            present: ["vale", "mara"],
            action,
          });
          assert(played.ok);
          world = played.world;
          if (scenario !== "unaccepted")
            history.push({ play: body.key, room: "station", lines: [] });
        }
        return route.abort("failed");
      }
      const view = dispatchShared({
        op: "view",
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
      });
      await route.fulfill({
        json: {
          ...view,
          id: "recovery",
          version: "full-card-world/9",
          claimed: [1, 0, 0, 0, 0, 0, 0, 0],
          present: [1, 0, 0, 0, 0, 0, 0, 0],
          now: Date.now(),
          queue:
            releasePolls && scenario === "queued"
              ? [{ id: keys[0], actor: "vale", status: "playing" }]
              : [],
          history: releasePolls && scenario !== "queued" ? history : [],
          notice:
            releasePolls && scenario === "new-notice" ? otherNotice : null,
        },
      });
    },
  );
  try {
    await page.goto(`${origin}/?world=recovery`);
    await page.waitForFunction(() => document.body.inert === false);
    await selectCard(page, "vale");
    await page.locator('#card-actions [data-action="wait"]').click();
    const expected =
      scenario === "validation" ? "Choose a current play." : "Failed to fetch";
    await page.waitForFunction(
      (text) => document.querySelector("#notice").textContent === text,
      expected,
    );
    releasePolls = true;
    if (["accepted", "queued"].includes(scenario))
      await page.waitForFunction(
        () => document.querySelector("#notice").hidden,
      );
    else if (scenario === "new-notice")
      await page.waitForFunction(
        (text) => document.querySelector("#notice").textContent === text,
        otherNotice,
      );
    await page.waitForTimeout(2200);
    assert.equal(
      keys.length,
      1,
      "Polling preserves the single submitted play.",
    );
    assert.equal(world.turn, scenario === "validation" ? 0 : 1);
    if (["unaccepted", "validation"].includes(scenario))
      assert.equal(await page.locator("#notice").textContent(), expected);
    if (scenario === "new-notice")
      assert.equal(await page.locator("#notice").textContent(), otherNotice);
    assert.deepEqual(errors, []);
    console.log(`Shared play recovery ${scenario} passed at ${width}px.`);
  } finally {
    await page.close();
  }
}
try {
  for (const width of [1440, 390]) {
    let world = dispatchShared({
      op: "create",
      save: encodeSave(createWorld()),
    }).world;
    const view = () =>
      dispatchShared({
        op: "view",
        world,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
      });
    const snapshot = () => ({
      ...view(),
      id: "ordering",
      version: "full-card-world/9",
      claimed: [1, 0, 0, 0, 0, 0, 0, 0],
      present: [1, 0, 0, 0, 0, 0, 0, 0],
      now: 1000,
      queue: [],
      history: [],
    });
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    let hold = false;
    let release;
    await page.route(
      /\/card-game\/shared\/worlds\/ordering(?:\/command)?$/,
      async (route) => {
        const body = route.request().postDataJSON();
        if (body?.op === "play") {
          const played = dispatchShared({
            op: "play",
            world,
            actor: "vale",
            claimed: ["vale"],
            present: ["vale"],
            action: body.action,
          });
          assert(played.ok);
          world = played.world;
        }
        if (!body && hold) {
          hold = false;
          const stale = snapshot();
          await new Promise((resolve) => {
            release = resolve;
          });
          await route.fulfill({ json: stale });
        } else await route.fulfill({ json: snapshot() });
      },
    );
    await page.goto(`${origin}/?world=ordering`);
    await page.waitForFunction(() => document.body.inert === false);
    await selectCard(page, "pond", { touch: width === 390 });
    hold = true;
    const holdDeadline = Date.now() + 15000;
    while (!release && Date.now() < holdDeadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert(release, "The next poll reaches the held response.");
    await page.locator('#card-actions [data-action="move"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#backdrop").src.includes("pond"),
    );
    const revision = world.revision;
    assert.equal(world.actors.vale.place, "pond");
    release();
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator("#stage").getAttribute("data-presented-revision"),
      String(revision),
    );
    assert(
      (await page.locator("#backdrop").getAttribute("src")).includes("pond"),
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `Shared delayed poll keeps the accepted pond arrival at ${width}px.`,
    );
  }
  for (const width of [1440, 390])
    for (const scenario of [
      "accepted",
      "queued",
      "new-notice",
      "unaccepted",
      "validation",
    ])
      await checkPlayRecovery(width, scenario);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
