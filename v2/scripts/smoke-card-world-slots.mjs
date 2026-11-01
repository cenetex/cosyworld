import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

// ☰'s world slots (#1877): tapping one of your avatars lights the places it
// can go (your deck, a slot with its seat free, + New world), and tapping
// one moves it there. A friend's world shows while your avatar sits there.
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

    // Tavi, in a friend's world, goes back to the deck.
    await friend.locator("summary").click();
    if (width <= 390) {
      const open = await menu
        .locator(".world-slot")
        .evaluateAll((slots) => slots.filter((slot) => slot.open).length);
      assert.equal(open, 1, "a phone opens one world at a time");
    }
    await friend.locator('[data-avatar="tavi"] button').click();
    const deck = menu.locator(".avatar-deck");
    assert.equal(await deck.getAttribute("data-target"), "true");
    await deck.locator(".slot-target").click();
    await friend.waitFor({ state: "detached" });
    assert.deepEqual(commands.shift(), ["friend", { op: "release" }]);
    assert.equal(await deck.locator('[data-avatar="tavi"]').count(), 1);
    // Your Tavi shows once; elsewhere Tavi's seat is a resident.
    assert.equal(
      await menu
        .locator('[data-avatar="tavi"]:not([data-kind="resident"])')
        .count(),
      1,
    );

    // Vale lights the deck, the spare slot and + New world, and moves.
    const current = menu.locator('.world-slot[data-current="true"]');
    if (!(await current.evaluate((slot) => slot.open)))
      await current.locator("summary").click();
    await page.locator("#avatar-move").click();
    assert.deepEqual(
      await menu
        .locator('.world-slot[data-target="true"]')
        .evaluateAll((slots) => slots.map((slot) => slot.dataset.slot)),
      ["spare"],
    );
    assert.equal(await deck.getAttribute("data-target"), "true");
    assert.equal(
      await page.locator("#avatar-new-world").getAttribute("data-target"),
      "true",
    );
    await page.screenshot({
      path: `output/card-world-slots-${width}.png`,
    });
    const spare = menu.locator('.world-slot[data-slot="spare"]');
    await Promise.all([
      page.waitForURL(/\?world=spare$/),
      spare.locator(".slot-target").click(),
    ]);
    assert.deepEqual(commands.shift(), [
      "spare",
      { op: "claim", avatar: "vale" },
    ]);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "World slots: an avatar lights its targets, steps away to the deck, and moves to a free slot at 390 and 1440.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
