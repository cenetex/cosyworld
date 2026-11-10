// Exercise real popover lifecycle and deferred menu IO at both viewport sizes.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/?menu-regression", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/card-game/style.css"><link rel="stylesheet" href="/card-game/toolbar.css"><button id="open" popovertarget="menu">Menu</button><div id="menu" class="world-menu" popover></div>',
      }),
    );
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?menu-regression`,
    );
    await page.evaluate(async () => {
      const { installAvatarMenu } = await import("/card-game/avatar-menu.mjs");
      window.pending = [];
      const original = window.fetch;
      window.fetch = (path, options) =>
        String(path).startsWith("/auth/") ||
        String(path).startsWith("/card-game/shared/")
          ? new Promise((resolve) =>
              pending.push((value) =>
                resolve(new Response(JSON.stringify(value))),
              ),
            )
          : original(path, options);
      window.menu = document.getElementById("menu");
      installAvatarMenu({
        menu,
        session: null,
        getWorld: () => ({ actors: {}, seed: 1 }),
        allowShared: () => true,
      });
    });
    const reply = async (index, value) => {
      await page.waitForFunction((i) => pending.length > i, index);
      await page.evaluate(({ index, value }) => pending[index](value), {
        index,
        value,
      });
    };
    const list = (id) => ({
      worlds: [{ id, owner: true, held: [] }],
      unlocked: ["vale"],
    });
    await page.locator("#open").click();
    await reply(0, { authenticated: true });
    await page.waitForFunction(() => pending.length === 2);
    await page.keyboard.press("Escape");
    await page.locator("#open").click();
    await reply(2, { authenticated: true });
    await reply(3, list("new"));
    await page.locator('[data-slot="new"]').waitFor();
    await reply(1, list("old"));
    await page.waitForTimeout(50);
    assert.deepEqual(
      await page
        .locator(".world-slot")
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.slot)),
      ["new"],
    );
    // Native toggle events coalesce when close and reopen share one task.
    await page.keyboard.press("Escape");
    await page.locator("#open").click();
    await page.waitForFunction(() => pending.length === 5);
    await page.evaluate(() => {
      menu.hidePopover();
      menu.showPopover();
    });
    await reply(5, { authenticated: true });
    await reply(6, list("coalesced"));
    await page.locator('[data-slot="coalesced"]').waitFor();
    await reply(4, { authenticated: false });
    await page.waitForTimeout(50);
    assert.equal(
      await page.locator(".world-slots").evaluate((node) => node.hidden),
      false,
    );
    // Light dismissal also retires pending refreshes.
    await page.keyboard.press("Escape");
    await page.locator("#open").click();
    await page.waitForFunction(() => pending.length === 8);
    await page.mouse.click(width - 5, 895);
    await reply(7, { authenticated: false });
    await page.waitForTimeout(50);
    assert.equal(
      await page
        .locator("#menu")
        .evaluate((node) => node.matches(":popover-open")),
      false,
    );
    assert.equal(
      await page.locator(".world-slots").evaluate((node) => node.hidden),
      false,
    );
    // History does not change menu ownership or resurrect an old response.
    await page.evaluate(() => history.pushState({}, "", "?menu-history"));
    await page.goBack();
    await page.goForward();
    assert.equal(
      await page
        .locator("#menu")
        .evaluate((node) => node.matches(":popover-open")),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(`avatar menu request lifecycle passed at ${width}px`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
