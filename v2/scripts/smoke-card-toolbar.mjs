import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { dispatchShared } from "../card-game/shared-world.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

const output = new URL("../../output/card-toolbar/", import.meta.url);
await mkdir(output, { recursive: true });
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const world = dispatchShared({
  op: "create",
  save: encodeSave(createWorld()),
}).world;
world.actors.vale.place = "pond";
world.actors.mara.place = "station";
const claimed = [1, 1, 1, 0, 0, 0, 0, 0];
let present = [1, 1, 1, 0, 0, 0, 0, 0];
let offline = false;
const roster = ["vale", "mara", "ash", "nell", "tavi", "rue", "orin", "ada"];
function snapshot() {
  const view = dispatchShared({
    op: "view",
    world,
    actor: "vale",
    claimed: roster.filter((_, i) => claimed[i]),
    present: roster.filter((_, i) => present[i]),
  });
  return {
    ...view,
    id: "toolbar",
    version: "full-card-world/3",
    claimed,
    present,
    bound: [1, 1, 1, 1, 0, 0, 0, 0],
    holders: [
      null,
      "Sable Swift",
      "Amber Heron",
      "Quiet Fox",
      null,
      null,
      null,
      null,
    ],
    owner: true,
    now: Date.now(),
    queue: [],
    history: [],
  };
}
try {
  for (const [width, height] of [
    [1440, 900],
    [701, 900],
    [390, 844],
    [320, 740],
    [844, 390],
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
    await page.route("**/auth/account", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.route(
      /\/card-game\/shared\/worlds\/toolbar(?:\/command)?$/,
      (route) =>
        offline
          ? route.fulfill({
              status: 503,
              json: { error: "Reconnecting to this world." },
            })
          : route.fulfill({ json: snapshot() }),
    );
    await page.goto(`${origin}/?world=toolbar`);
    // One button opens ☰; its face shows the friends online here, Mara
    // and Ash, and not you (owner, 2026-11-01).
    const toggle = page.locator("#toolbar-menu-button");
    await toggle.waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll(".friend-chips img").length === 2,
    );
    assert.equal(
      await toggle.getAttribute("aria-label"),
      "Menu, 2 friends online",
    );
    await page.waitForFunction(() => document.body.inert === false);
    const bounds = await page
      .locator(".top-actions button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return {
            id: button.id,
            x: box.x,
            right: box.right,
            width: box.width,
            height: box.height,
            label: button.getAttribute("aria-label"),
          };
        }),
      );
    assert.equal(bounds.length, 1);
    for (const box of bounds) {
      assert(box.x >= 0 && box.right <= width, `${box.id} fits at ${width}`);
      assert(
        box.width >= 44 && box.height >= 44,
        `${box.id} has a full tap target`,
      );
      assert(box.label, `${box.id} has an accessible name`);
    }
    await page.screenshot({
      path: new URL(`toolbar-${width}.png`, output).pathname,
    });
    const menuToggle = toggle;
    await menuToggle.focus();
    await page.keyboard.press("Enter");
    const menu = page.locator("#world-menu");
    await menu.waitFor({ state: "visible" });
    assert.deepEqual(
      await menu.locator(".menu-tools button").allTextContents(),
      ["Memory", "Invite", "Settings"],
    );
    // ☰ lists world slots; the world played now shows, on one line, the
    // avatars that entered it and "+" for its open seats (#1877).
    const current = menu.locator('.world-slot[data-current="true"]');
    const seats = current.locator(".slot-seat:not(.slot-open)");
    await current.locator(".seat-open").waitFor();
    assert.equal(await seats.count(), 4);
    assert.equal(await current.locator(".seat-open").count(), 1);
    const tops = await seats.evaluateAll((rows) =>
      rows.map((row) => Math.round(row.getBoundingClientRect().top)),
    );
    assert.equal(new Set(tops).size, 1, `one line of seats at ${width}`);
    const kinds = () =>
      seats.evaluateAll((rows) => rows.map((row) => row.dataset.kind));
    // In R·A·T·V·M·I·C·S order (#1846): Ash, Vale, Mara and Iris.
    assert.deepEqual(await kinds(), ["human", "you", "human", "human"]);
    assert.equal(await current.locator('[data-lit="true"]').count(), 3);
    assert.doesNotMatch(await menu.innerText(), /Black pond|Empty station/);
    // Each avatar shows once: no avatar list and no Send to….
    assert.equal(await menu.locator(".avatar-row, .avatar-list").count(), 0);
    assert.doesNotMatch(await menu.innerText(), /Send to/);
    // The card below shows the avatar being played, with no action until
    // a portrait is tapped; a tapped seat shows that avatar's card. A seat's
    // action is a beat in front of the dialogue, outside ☰.
    const card = menu.locator(".profile-card");
    const actions = page.locator(
      ".dialogue .action-panel #card-actions button",
    );
    const note = page.locator(".dialogue > .action-panel .action-beat-note");
    assert.match(await card.innerText(), /Vale[\s\S]*online/);
    assert.equal(await card.getAttribute("data-avatar"), "vale");
    assert.equal(await actions.count(), 0);
    await seats.nth(2).locator("button").click();
    assert.match(await card.innerText(), /Mara[\s\S]*Sable Swift · online/);
    await seats.nth(1).locator("button").click();
    // Choosing your own avatar offers Leave, with what it costs.
    assert.deepEqual(await actions.allInnerTexts(), ["Leave"]);
    assert.match(await note.innerText(), /^Vale keeps their level/);
    await page.screenshot({
      path: new URL(`menu-${width}.png`, output).pathname,
    });
    const tools = await menu.locator(".menu-tools").boundingBox();
    assert(tools.y + tools.height <= height, `tools stay in view at ${width}`);
    // A second tap plays the chosen avatar; here it is the one being
    // played, so ☰ just closes and its beat leaves.
    await seats.nth(1).locator("button").click();
    await menu.waitFor({ state: "hidden" });
    await actions.first().waitFor({ state: "detached" });
    await menuToggle.click();
    // A real pointer press outside the popover performs light dismissal.
    await page.mouse.click(5, 100);
    await menu.waitFor({ state: "hidden" });
    // The owner arms another's seat with a second tap: one Free.
    await toggle.click();
    await menu.waitFor({ state: "visible" });
    await seats.nth(0).locator("button").click();
    assert.equal(await actions.count(), 0);
    await seats.nth(0).locator("button").click();
    const free = page.locator("#avatar-free");
    assert.deepEqual(await actions.allInnerTexts(), ["Free"]);
    assert.match(
      await note.innerText(),
      /Removes Amber Heron's hold and resets Ash/,
    );
    // ☰ stays open beside the beat: they do not overlap, except on a short
    // landscape phone, where ☰ lies over part of it until it closes.
    const [menuBox, beatBox] = await Promise.all(
      [menu, page.locator(".dialogue > .action-panel")].map((l) =>
        l.boundingBox(),
      ),
    );
    assert(
      height < 500 ||
        menuBox.y + menuBox.height <= beatBox.y ||
        menuBox.x >= beatBox.x + beatBox.width,
      `☰ clear of the beat at ${width}`,
    );
    await page.screenshot({
      path: new URL(`table-${width}.png`, output).pathname,
    });
    if (width === 1440) {
      present[2] = 0;
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            '.world-slot[data-current="true"] [data-lit="true"]',
          ).length === 2,
      );
      assert.match(await toggle.getAttribute("aria-label"), /1 friend online/);
      // A presence redraw keeps the card armed; a tap elsewhere disarms.
      assert.equal(await free.innerText(), "Free");
      await card.locator(".profile-art").click();
      assert.equal(await actions.count(), 0);
    }
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    for (const [button, target] of [
      ["menu-button", "menu-dialog"],
      ["history-button", "history-dialog"],
    ]) {
      await menuToggle.click();
      await page.locator(`#${button}`).click();
      await menu.waitFor({ state: "hidden" });
      assert(await page.locator(`#${target}`).evaluate((node) => node.open));
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.activeElement?.id === "toolbar-menu-button",
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
    present = [1, 1, 1, 0, 0, 0, 0, 0];
    world.actors.mara.place = "station";
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(origin);
  // Signed out, the one button still opens ☰'s tools, with no friends.
  assert.equal(
    await page.locator("#toolbar-menu-button").getAttribute("aria-label"),
    "Menu",
  );
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#world-menu").waitFor({ state: "visible" });
  // Signed out, ☰ has no world UI at all, only its tools (#1892).
  await page.locator("#history-button").waitFor({ state: "visible" });
  assert(await page.locator(".world-slots").isHidden());
  assert.doesNotMatch(
    await page.locator("#world-menu").innerText(),
    /on this device|New world/,
  );
  await page.locator("#menu-button").click();
  await page.locator("#new-game").click();
  await page.locator("#reset-dialog").waitFor({ state: "visible" });
  await page.locator("#cancel-reset").click();
  console.log(
    "Toolbar: five screen sizes, keyboard, the world slots, presence, the owner's Free, and solo play passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
