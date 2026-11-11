import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { pressSetting, closeSettings } from "./card-browser-helpers.mjs";
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
async function waitForMenu(page, open) {
  await page.locator("#world-menu").waitFor({
    state: open ? "visible" : "hidden",
  });
  // Native visibility changes before the queued toggle event updates ARIA.
  await page.waitForFunction(
    (open) =>
      document.getElementById("world-menu")?.matches(":popover-open") ===
        open &&
      document
        .getElementById("toolbar-menu-button")
        ?.getAttribute("aria-expanded") === String(open),
    open,
  );
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
      route.fulfill({ json: { authenticated: true, user_id: "smoke-user", account_revision: 0 } }),
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
    const originalMenu = await page.locator("#world-menu").elementHandle();
    const saved = await page.evaluate(() =>
      localStorage.getItem("cosyworld.reflected-shore.v1"),
    );
    // Reproduce the reported missing popover target without changing the save.
    await originalMenu.evaluate((element) => element.remove());
    assert.equal(await page.locator("#world-menu").count(), 0);
    await menuToggle.focus();
    await page.keyboard.press("Enter");
    const menu = page.locator("#world-menu");
    await waitForMenu(page, true);
    assert(
      await menu.evaluate(
        (element, original) => element === original,
        originalMenu,
      ),
    );
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
    // ☰ has no profile card: a tapped seat shows that avatar, who plays it
    // and where, as a beat in front of the dialogue, outside ☰, with
    // its action on the right when it has one.
    assert.equal(await menu.locator(".profile-card").count(), 0);
    const card = page.locator(".dialogue > .action-panel");
    const actions = page.locator(
      ".dialogue .action-panel #card-actions button",
    );
    const note = page.locator(".dialogue > .action-panel .action-beat-note");
    assert.equal(await actions.count(), 0);
    await seats.nth(2).locator("button").click();
    assert.equal(await card.getAttribute("data-avatar"), "mara");
    assert.match(
      await card.locator(".action-beat-heading").innerText(),
      /^Mara\nSable Swift · Exploring /,
    );
    assert.equal(await actions.count(), 0);
    await seats.nth(1).locator("button").click();
    // Choosing your own avatar offers Leave, with no note.
    assert.deepEqual(await actions.allInnerTexts(), ["Leave"]);
    assert(await note.isHidden());
    await page.screenshot({
      path: new URL(`menu-${width}.png`, output).pathname,
    });
    const tools = await menu.locator(".menu-tools").boundingBox();
    assert(tools.y + tools.height <= height, `tools stay in view at ${width}`);
    // Tapping the avatar being played again only keeps it chosen: ☰ stays
    // open with Leave, and nothing arms.
    await seats.nth(1).locator("button").click();
    assert(await menu.isVisible());
    assert.deepEqual(await actions.allInnerTexts(), ["Leave"]);
    assert.equal(
      await seats.nth(1).locator("button").getAttribute("data-armed"),
      null,
    );
    // A real pointer press outside the popover performs light dismissal,
    // and the beat leaves with it.
    await page.mouse.click(5, 100);
    await waitForMenu(page, false);
    await actions.first().waitFor({ state: "detached" });
    // The owner arms another's seat with a second tap: one Free.
    await originalMenu.evaluate((element) => element.remove());
    await toggle.click();
    await waitForMenu(page, true);
    assert.equal(await page.locator("#world-menu").count(), 1);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("cosyworld.reflected-shore.v1"),
      ),
      saved,
    );
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
      await current.locator(".slot-name").click();
      assert.equal(await actions.count(), 0);
      assert.equal(await card.getAttribute("data-avatar"), "ash");
    }
    await page.keyboard.press("Escape");
    await waitForMenu(page, false);
    for (const [button, target] of [
      ["menu-button", "settings-screen"],
      ["history-button", "history-dialog"],
    ]) {
      await menuToggle.click();
      await page.locator(`#${button}`).click();
      await waitForMenu(page, false);
      assert(await page.locator(`#${target}`).evaluate((node) => node.open));
      if (target === "history-dialog") {
        // Memory has no title bar: a quiet × in the corner, no export.
        const memory = page.getByRole("dialog", { name: "Memory" });
        assert.equal(await memory.getByRole("button").count(), 1);
        await memory
          .getByRole("button", { name: "Close", exact: true })
          .waitFor();
      }
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
  await waitForMenu(page, true);
  // Signed out, ☰ has no world UI at all, only its tools (#1892).
  await page.locator("#history-button").waitFor({ state: "visible" });
  assert(await page.locator(".world-slots").isHidden());
  assert.doesNotMatch(
    await page.locator("#world-menu").innerText(),
    /on this device|New world/,
  );
  await page.locator("#menu-button").click();
  await pressSetting(page, "new-game");
  assert.equal(
    await page.textContent("#setting-new-game"),
    "Tap again to replace this world",
  );
  await closeSettings(page);
  console.log(
    "Toolbar: five screen sizes, keyboard, the world slots, presence, the owner's Free, and solo play passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
