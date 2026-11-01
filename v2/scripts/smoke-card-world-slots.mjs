import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

// ☰'s world slots (#1877, #1891): a seat is in colour only while online, a
// tap shows its stats, and two taps on a grey seat move its avatar there.
// A friend's world shows while your avatar sits there, and a second tap on
// your seat there offers Step away, which releases it and keeps its level.
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const world = dispatchShared({
  op: "create",
  save: encodeSave(createWorld()),
}).world;
// Seat order: vale, mara, ash, nell, tavi, rue, orin, ada.
const seats = (...held) => held.concat(Array(8 - held.length).fill(0));
const snapshot = (id) => ({
  ...dispatchShared({
    op: "view",
    world,
    actor: "vale",
    claimed: ["vale"],
    present: ["vale"],
  }),
  id,
  version: "full-card-world/3",
  claimed: seats(1),
  present: seats(1),
  bound: seats(1),
  holders: seats(null),
  owner: true,
  now: Date.now(),
  queue: [],
  history: [],
});
try {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      isMobile: width <= 390,
      hasTouch: width <= 390,
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const commands = [];
    let tavi = "tavi";
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.route(/\/card-game\/shared\/worlds$/, (route) =>
      route.fulfill({
        json: {
          worlds: [
            { id: "here", owner: true, actor: "vale", held: seats(1), seed: 1 },
            // Someone holds Mara in the spare slot; Vale's seat is free.
            {
              id: "spare",
              owner: true,
              actor: null,
              held: seats(0, 1),
              seed: 2,
            },
            {
              id: "friend",
              owner: false,
              actor: tavi,
              held: seats(0, 0, 0, 0, tavi ? 1 : 0),
              seed: 3,
            },
          ],
        },
      }),
    );
    await page.route(
      /\/card-game\/shared\/worlds\/(\w+)\/command$/,
      (route) => {
        const body = route.request().postDataJSON();
        const id = route.request().url().split("/").at(-2);
        if (!["enter", "heartbeat"].includes(body.op))
          commands.push([id, body]);
        if (body.op === "release") tavi = null;
        route.fulfill({ json: snapshot(id) });
      },
    );
    await page.route(/\/card-game\/shared\/worlds\/(here|spare)$/, (route) =>
      route.fulfill({
        json: snapshot(route.request().url().split("/").at(-1)),
      }),
    );
    await page.goto(`${origin}/?world=here`);
    await page.waitForFunction(() => document.body.inert === false);
    const menu = page.locator("#world-menu");
    await page.locator("#toolbar-menu-button").click();
    const friend = menu.locator('.world-slot[data-slot="friend"]');
    await friend.waitFor();
    assert.equal(await menu.locator(".world-slot").count(), 3);
    assert.match(
      await friend.locator("summary").innerText(),
      /a friend's world/,
    );

    await friend.locator("summary").click();
    if (width <= 390) {
      const open = await menu
        .locator(".world-slot")
        .evaluateAll((slots) => slots.filter((slot) => slot.open).length);
      assert.equal(open, 1, "a phone opens one world at a time");
    }
    // Vale is online in the world being played, in colour there only.
    const lit = await menu
      .locator('[data-avatar="vale"]')
      .evaluateAll((seats) => seats.map((seat) => seat.dataset.lit));
    assert.deepEqual(lit, ["true", "false", "false"]);
    // Your Tavi in the friend's world: one tap shows Play and Release, a
    // second offers Step away, and that releases the seat (no reset).
    const yours = friend.locator('[data-avatar="tavi"] button');
    await yours.click();
    const step = menu.locator("#avatar-step-away");
    assert.equal(await step.count(), 0);
    assert.ok(
      await friend
        .getByText("Release · start over", { exact: true })
        .isVisible(),
    );
    await yours.click();
    await step.waitFor();
    assert.match(
      await menu.locator(".avatar-status").innerText(),
      /Tavi's level goes with Tavi\./,
    );
    await page.screenshot({
      path: `output/card-world-slots-step-away-${width}.png`,
    });
    await step.click();
    await friend.waitFor({ state: "detached" });
    assert.deepEqual(commands.shift(), ["friend", { op: "release" }]);
    assert.equal(await menu.locator(".world-slot").count(), 2);
    // Someone's offline Mara is grey, and a tap only shows who plays her.
    const spare = menu.locator('.world-slot[data-slot="spare"]');
    await spare.locator("summary").click();
    await spare.locator('[data-avatar="mara"] button').click();
    const stats = menu.locator(".avatar-stats");
    assert.match(await stats.innerText(), /Mara\nPlayed by Someone · offline/);
    // Vale's grey seat in the spare world: one tap selects, two move.
    const vale = spare.locator('[data-avatar="vale"] button');
    await vale.click();
    assert.match(
      await stats.innerText(),
      /^Vale\nLives here on their own · your Vale is in .+$/,
    );
    assert.match(
      await menu.locator(".avatar-status").innerText(),
      /Tap Vale again to bring Vale here\./,
    );
    await page.screenshot({
      path: `output/card-world-slots-${width}.png`,
    });
    await Promise.all([page.waitForURL(/\?world=spare$/), vale.click()]);
    assert.deepEqual(commands.shift(), [
      "spare",
      { op: "claim", avatar: "vale" },
    ]);
    // Signed in at Vale's local table, ☰ lists only the shared worlds: the
    // local save is its own passkey, never an "on this device" slot (#1892).
    await page.evaluate(() => localStorage.removeItem("cosyworld.playing"));
    await page.goto(origin);
    await page.locator("#toolbar-menu-button").click();
    await menu.locator('.world-slot[data-slot="spare"]').waitFor();
    assert.equal(
      await menu.locator('.world-slot[data-current="true"]').count(),
      0,
    );
    assert.doesNotMatch(await menu.innerText(), /on this device/);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "World slots: colour is presence, a tap shows stats, two taps move an avatar, and two on yours step it away, at 390 and 1440.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
