import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";
import { worldName } from "../card-game/world-name.mjs";

// ☰'s world slots (#1877, #1891): a world shows the avatars that entered
// it, in colour only while online, then "+" for an open seat. A tap shows
// that avatar as a beat in front of the dialogue (☰ has no profile card):
// it stands as on the quest card. Your chosen avatar's card names who
// leaves and which world they leave. One tap on yours in another world
// switches there, and ☰ opens with it chosen. On another's
// a second tap arms it for the owner's Free. "+" offers your
// avatar in the beat. A friend's world shows while your avatar sits
// there; Leave releases it and keeps its level. A world nobody is in has
// closed on the server and is not listed; + New world starts a fresh one
// for the chosen avatar.
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
// The friend's world is played as Tavi, in seat five.
const snapshot = (id, nudgeReady) => {
  const actor = id === "friend" ? "tavi" : "vale";
  const seed = { here: 1, spare: 2, friend: 3 }[id];
  const maraHere = nudgeReady && id === "here";
  const players = maraHere ? [actor, "mara"] : [actor];
  const seat =
    id === "friend" ? seats(0, 0, 0, 0, 1) : maraHere ? seats(1, 1) : seats(1);
  if (maraHere) world.actors.mara.place = world.actors.vale.place;
  return {
    ...dispatchShared({
      op: "view",
      world: { ...world, run: { seed } },
      actor,
      claimed: players,
      present: players,
    }),
    id,
    version: "full-card-world/3",
    claimed: seat,
    present: seat,
    bound: seat,
    holders: seats(null),
    owner: id !== "friend",
    now: Date.now(),
    queue: [],
    history: [],
  };
};
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
    let nudgeReady = false;
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
                  held: nudgeReady ? seats(1, 1) : seats(1),
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
        route.fulfill({ json: snapshot(id, nudgeReady) });
      },
    );
    await page.route(
      /\/card-game\/shared\/worlds\/(here|spare|friend)$/,
      (route) =>
        route.fulfill({
          json: snapshot(route.request().url().split("/").at(-1), nudgeReady),
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
      .locator('.world-slot .slot-seat[data-avatar="vale"]')
      .evaluateAll((seats) => seats.map((seat) => seat.dataset.lit));
    assert.deepEqual(lit, ["true"]);
    assert.equal(await friend.locator(".slot-seat").count(), 2);
    // ☰ has no profile card, and nothing is chosen yet.
    assert.equal(await menu.locator(".profile-card").count(), 0);
    const card = page.locator(".dialogue > .action-panel");
    assert(await card.isHidden());
    // The Vale being played: a tap only chooses her (she glows) and offers
    // Leave in front of the dialogue; a second tap keeps her chosen.
    const valeFace = menu.locator(
      '.world-slot[data-current="true"] [data-avatar="vale"] button',
    );
    const taviFace = friend.locator('[data-avatar="tavi"] button');
    const actions = page.locator(
      ".dialogue > .action-panel #card-actions button",
    );
    const note = page.locator(".dialogue > .action-panel .action-beat-note");
    await valeFace.click();
    assert.equal(await card.getAttribute("data-avatar"), "vale");
    assert.equal(await valeFace.getAttribute("aria-pressed"), "true");
    assert.equal(
      await card.locator(".action-beat-heading").innerText(),
      `Vale leaves ${worldName(1)}`,
    );
    assert.equal(await card.getAttribute("data-card-tap"), "hint");
    assert.equal(await card.locator(".beat-face.quest-screen").count(), 1);
    assert.equal(await actions.innerText(), "Tap to leave");
    assert.equal(await actions.getAttribute("aria-label"), "Leave");
    const [art, words] = await Promise.all(
      [".action-beat-cards", ".action-beat-body"].map((part) =>
        card.locator(part).boundingBox(),
      ),
    );
    assert(art.x < words.x);
    const hint = await actions.evaluate((button) => {
      const range = document.createRange();
      range.selectNodeContents(button);
      const text = range.getBoundingClientRect();
      const panel = button.closest("#action-beat").getBoundingClientRect();
      return {
        right: panel.right - text.right,
        bottom: panel.bottom - text.bottom,
      };
    });
    assert(hint.right > 0 && hint.right < 20);
    assert(hint.bottom > 0 && hint.bottom < 20);

    assert(await note.isHidden());
    await shot(`output/card-world-slots-selected-${width}.png`);
    await valeFace.click();
    assert(await menu.isVisible());
    assert.equal(await valeFace.getAttribute("aria-pressed"), "true");
    assert.equal(await valeFace.getAttribute("data-armed"), null);
    assert.equal(await actions.getAttribute("aria-label"), "Leave");
    // Your Tavi in the friend's world: one tap switches there at once, a
    // plain page change with no veil, and ☰ opens there with Tavi chosen,
    // Leave on the right.
    await Promise.all([page.waitForURL(/\?world=friend$/), taviFace.click()]);
    await page.waitForFunction(() => document.body.inert === false);
    await menu.waitFor({ state: "visible" });
    const arrived = menu.locator('.world-slot[data-current="true"]');
    assert.equal(await arrived.getAttribute("data-slot"), "friend");
    assert.equal(
      await arrived
        .locator('[data-avatar="tavi"] button')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(await card.getAttribute("data-avatar"), "tavi");
    assert.equal(
      await card.locator(".action-beat-heading").innerText(),
      `Tavi leaves ${worldName(3)}`,
    );
    assert.equal(await actions.innerText(), "Tap to leave");
    assert(await note.isHidden());
    await shot(`output/card-world-slots-arrived-${width}.png`);
    // Leave there frees her seat; the bare address opens with ☰.
    await Promise.all([
      page.waitForURL(`${origin}/`),
      page.locator("#avatar-leave").click(),
    ]);
    assert.deepEqual(commands.shift(), ["friend", { op: "release" }]);
    await menu.waitFor({ state: "visible" });
    await page.goto(`${origin}/?world=here`);
    await page.waitForFunction(() => document.body.inert === false);
    await page.locator("#toolbar-menu-button").click();
    await menu.locator('.world-slot[data-slot="spare"]').waitFor();
    assert.equal(await friend.count(), 0);
    assert.equal(await menu.locator(".world-slot").count(), 2);
    // Someone's offline Mara is grey; her beat says who plays her, with no
    // button until, armed, the owner may free her.
    const spare = menu.locator('.world-slot[data-slot="spare"]');
    await spare.locator('[data-avatar="mara"] button').click();
    assert.match(await card.innerText(), /Mara\nSomeone · Exploring /);
    assert.equal(
      await card.locator(".beat-face").getAttribute("data-lit"),
      "false",
    );
    assert.equal(await actions.count(), 0);
    await spare.locator('[data-avatar="mara"] button').click();
    assert.equal(await actions.getAttribute("aria-label"), "Free");
    // "+" in the spare world offers Vale on the card, and each tap the next
    // avatar that may go there, up to Tavi, who stepped away; she comes.
    const open = spare.locator(".seat-open");
    await open.click();
    assert.equal(await card.getAttribute("data-avatar"), "vale");
    const bring = page.locator("#avatar-bring");
    assert.match(await bring.getAttribute("aria-label"), /^Bring to /);
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
    nudgeReady = true;
    await page.goto(`${origin}/?world=here`);
    await page.waitForFunction(() => document.body.inert === false);
    await page.locator("#toolbar-menu-button").click();
    await menu
      .locator('.world-slot[data-current="true"] [data-avatar="mara"] button')
      .click();
    assert.equal(await actions.getAttribute("aria-label"), "Nudge");
    await Promise.all([
      page.waitForResponse(
        (response) => response.request().postDataJSON()?.op === "nudge",
      ),
      actions.first().click(),
    ]);
    assert.deepEqual(commands.shift(), [
      "here",
      { op: "nudge", target: "mara" },
    ]);
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
