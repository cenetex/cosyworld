import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

// ☰'s world slots (#1877, #1891): a world shows the avatars that entered
// it, in colour only while online, then "+" for an open seat. A tap shows
// an avatar's card with its actions; "+" offers your avatar on the card. A friend's world shows while
// your avatar sits there; Step away on your avatar's card releases it and
// keeps its level.
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
    // Screenshots wait for the menu's portraits.
    const shot = async (path) => {
      await page.waitForFunction(() =>
        [...document.querySelectorAll("#world-menu img")].every(
          (i) => i.complete,
        ),
      );
      await page.screenshot({ path });
    };
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
    assert.equal(
      await friend.locator(".slot-mark").getAttribute("aria-label"),
      "A friend's world",
    );
    // A world shows only the avatars that entered it, then "+": Vale is in
    // colour where she is played now, and nowhere else.
    const lit = await menu
      .locator('.slot-seat[data-avatar="vale"]')
      .evaluateAll((seats) => seats.map((seat) => seat.dataset.lit));
    assert.deepEqual(lit, ["true"]);
    assert.equal(await friend.locator(".slot-seat").count(), 2);
    // The card starts on the avatar being played.
    const card = menu.locator(".profile-card");
    assert.equal(await card.getAttribute("data-avatar"), "vale");
    // Your Tavi in the friend's world: the card holds Play, Step away and
    // Release; Step away asks with a second tap and releases (no reset).
    await friend.locator('[data-avatar="tavi"] button').click();
    assert.equal(await card.getAttribute("data-avatar"), "tavi");
    assert.match(await card.innerText(), /Play[\s\S]*Release · start over/);
    const step = menu.locator("#avatar-step-away");
    await step.click();
    assert.match(
      await menu.locator(".avatar-status").innerText(),
      /Tavi's level goes with Tavi\./,
    );
    await shot(`output/card-world-slots-step-away-${width}.png`);
    await step.click();
    await friend.waitFor({ state: "detached" });
    assert.deepEqual(commands.shift(), ["friend", { op: "release" }]);
    assert.equal(await menu.locator(".world-slot").count(), 2);
    // Someone's offline Mara is grey; her card says who plays her, and the
    // owner may free her.
    const spare = menu.locator('.world-slot[data-slot="spare"]');
    await spare.locator('[data-avatar="mara"] button').click();
    assert.match(await card.innerText(), /Someone · offline/);
    assert.deepEqual(await card.locator(".avatar-act").allInnerTexts(), [
      "Free Mara",
    ]);
    // "+" in the spare world offers Vale on the card, and each tap the next
    // avatar that may go there, up to Tavi, who stepped away; she comes.
    const open = spare.locator(".seat-open");
    await open.click();
    assert.equal(await card.getAttribute("data-avatar"), "vale");
    const bring = menu.locator("#avatar-bring");
    assert.match(await bring.innerText(), /^Bring to /);
    await open.click();
    assert.equal(await card.getAttribute("data-avatar"), "rue");
    await open.click();
    await open.click();
    assert.equal(await card.getAttribute("data-avatar"), "tavi");
    await shot(`output/card-world-slots-${width}.png`);
    await Promise.all([page.waitForURL(/\?world=spare$/), bring.click()]);
    assert.deepEqual(commands.shift(), [
      "spare",
      { op: "claim", avatar: "tavi" },
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
    assert.equal(await page.locator("#new-game").getAttribute("hidden"), "");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "World slots: entered avatars and +, colour is presence, the card and its actions, + offers a move, and Step away, at 390 and 1440.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
