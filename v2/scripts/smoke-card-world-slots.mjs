import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { worldName } from "../card-game/world-name.mjs";

// ☰'s world slots (#1877, #1891): a world shows the avatars that entered
// it, in colour only while online, then "+" for an open seat. A tap shows
// an avatar's card; on yours it also offers Leave as a beat in front of
// the dialogue, and a second tap plays it, dealing the table over to its
// world. On another's a second tap arms it for the owner's Free. "+" offers
// your avatar on the card. A friend's world shows while your avatar sits
// there; Leave releases it and keeps its level. A world nobody is in has
// closed on the server and is not listed; + New world starts a fresh one
// for the card's avatar.
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
      route.request().method() === "POST"
        ? (commands.push(["new", route.request().postDataJSON()]),
          route.fulfill({ json: { id: "fresh" } }))
        : route.fulfill({
            json: {
              worlds: [
                {
                  id: "here",
                  owner: true,
                  actor: "vale",
                  held: seats(1),
                  seed: 1,
                },
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
    // Your Tavi in the friend's world: one tap chooses her (she glows) and
    // offers Leave in front of the dialogue; a second tap goes to her world
    // over a shuffle of card backs.
    const taviFace = friend.locator('[data-avatar="tavi"] button');
    const actions = page.locator(
      ".dialogue > .action-panel #card-actions button",
    );
    const note = page.locator(".dialogue > .action-panel .action-beat-note");
    await taviFace.click();
    assert.equal(await card.getAttribute("data-avatar"), "tavi");
    assert.equal(await taviFace.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await actions.allInnerTexts(), ["Leave"]);
    assert.match(
      await note.innerText(),
      new RegExp(
        `^Tavi keeps their level; the seat in ${worldName(3)} opens\\.$`,
      ),
    );
    await shot(`output/card-world-slots-selected-${width}.png`);
    await page.route(/\?world=friend$/, (route) =>
      route.fulfill({ contentType: "text/html", body: "<p>friend</p>" }),
    );
    await Promise.all([
      page.waitForURL(/\?world=friend$/),
      (async () => {
        await taviFace.click();
        await page.locator(".table-shuffle").waitFor({ state: "attached" });
        assert.equal(await page.locator(".table-shuffle img").count(), 3);
      })(),
    ]);
    await page.goBack();
    await page.waitForFunction(() => document.body.inert === false);
    await page.locator("#toolbar-menu-button").click();
    await taviFace.click();
    await page.locator("#avatar-leave").click();
    await friend.waitFor({ state: "detached" });
    assert.deepEqual(commands.shift(), ["friend", { op: "release" }]);
    assert.equal(
      await menu.locator(".avatar-status").innerText(),
      `Tavi left ${worldName(3)}.`,
    );
    assert.equal(await menu.locator(".world-slot").count(), 2);
    // Someone's offline Mara is grey; her card says who plays her, and,
    // armed, the owner may free her.
    const spare = menu.locator('.world-slot[data-slot="spare"]');
    await spare.locator('[data-avatar="mara"] button').click();
    assert.match(await card.innerText(), /Someone · offline/);
    await spare.locator('[data-avatar="mara"] button').click();
    assert.deepEqual(await actions.allInnerTexts(), ["Free"]);
    // "+" in the spare world offers Vale on the card, and each tap the next
    // avatar that may go there, up to Tavi, who stepped away; she comes.
    const open = spare.locator(".seat-open");
    await open.click();
    assert.equal(await card.getAttribute("data-avatar"), "vale");
    const bring = page.locator("#avatar-bring");
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
    // + New world starts a fresh world for the card's avatar in no world.
    const fresh = menu.locator("#avatar-new-world");
    assert.equal(await fresh.innerText(), "+ New world");
    const plus = menu.locator('.world-slot[data-slot="spare"] .seat-open');
    await plus.click();
    await plus.click();
    assert.equal(await card.getAttribute("data-avatar"), "rue");
    await Promise.all([page.waitForURL(/\?world=fresh$/), fresh.click()]);
    assert.deepEqual(commands.splice(0), [["new", { avatar: "rue" }]]);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "World slots: entered avatars and +, colour is presence, the card, armed with its actions, + offers a move, Leave, and + New world for the card's avatar, at 390 and 1440.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
