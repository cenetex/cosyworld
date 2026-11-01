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
      "Sage Swift",
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
    const toggle = page.locator("#players-button");
    await toggle.waitFor();
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
    assert.equal(bounds.length, 2);
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
    const menuToggle = page.locator("#toolbar-menu-button");
    await menuToggle.focus();
    await page.keyboard.press("Enter");
    const menu = page.locator("#world-menu");
    await menu.waitFor({ state: "visible" });
    assert.deepEqual(
      await menu.locator(".menu-tools button").allTextContents(),
      ["Memory", "Inner life", "Invite", "Settings"],
    );
    // ☰ lists the eight avatars; the one played now is open, here.
    await menu.locator(".avatar-row").nth(7).waitFor();
    assert.equal(await menu.locator(".avatar-row").count(), 8);
    assert.match(
      await menu.locator('[data-here="true"]').innerText(),
      /^Vale[\s\S]*here[\s\S]*Send to…[\s\S]*Step away[\s\S]*Release$/,
    );
    await page.screenshot({
      path: new URL(`menu-${width}.png`, output).pathname,
    });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await menuToggle.click();
    // A real pointer press outside the popover performs light dismissal.
    await page.mouse.click(5, 100);
    await menu.waitFor({ state: "hidden" });
    // 👥 opens the same ☰, whose Table shows each seat and who is here.
    await toggle.click();
    await menu.waitFor({ state: "visible" });
    const seats = menu.locator(".table-seat");
    assert.equal(await seats.count(), 8);
    const kinds = () =>
      seats.evaluateAll((rows) => rows.map((row) => row.dataset.kind));
    assert.deepEqual(await kinds(), [
      "you",
      "human",
      "human",
      "away",
      "open",
      "open",
      "open",
      "open",
    ]);
    assert.match(await seats.nth(1).innerText(), /Mara\s+Sage Swift · Level 1/);
    assert.match(await seats.nth(0).innerText(), /Vale\s+You · Level 1/);
    assert.equal(await menu.locator(".table-online").count(), 3);
    assert.match(
      await menu.innerText(),
      /3 humans here now · 4 of 8 seats free/,
    );
    assert.doesNotMatch(await menu.innerText(), /Black pond|Empty station/);
    // The owner frees a seat with a second tap.
    const free = seats.nth(2).locator("button");
    assert.equal(await free.innerText(), "Free Ash");
    await page.screenshot({
      path: new URL(`table-${width}.png`, output).pathname,
    });
    if (width === 1440) {
      await free.click();
      assert.equal(await free.innerText(), "Free Ash?");
      assert.match(
        await menu.locator(".avatar-status").innerText(),
        /removes Amber Heron's hold and resets Ash/,
      );
      present[2] = 0;
      await page.waitForFunction(
        () => document.querySelectorAll(".table-online").length === 2,
      );
      assert.match(await toggle.getAttribute("aria-label"), /2 online/);
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
  await page.locator("#players-button").click();
  await page.locator("#world-menu").waitFor({ state: "visible" });
  assert.equal(await page.locator(".table-seat").count(), 0);
  console.log(
    "Toolbar: five screen sizes, keyboard, the Table, presence, the owner's Free, and solo play passed.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
