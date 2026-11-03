// Play counts (#2052): one batch of daily totals on pagehide; with Settings
// off or under Global Privacy Control, no request is sent at all.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, encodeSave } from "../card-game/world.mjs";

const server = createServer();
const batches = [];
server.on("request", (req) => {
  if (req.url !== "/card-game/metrics") return;
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => batches.push(JSON.parse(body)));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const save = encodeSave(createWorld());
const browser = await chromium.launch({ headless: true });
const settle = () => new Promise((resolve) => setTimeout(resolve, 2500));

async function open(name, width, { gpc = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: width > 500 ? 900 : 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/auth/account", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  const table = `${name}-${width}`;
  await page.addInitScript(
    ({ key, save, gpc }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, save);
      if (gpc)
        Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
          get: () => true,
        });
    },
    { key: `cosyworld.reflected-shore.v1.${table}`, save, gpc },
  );
  await page.goto(`${origin}/?table=${table}`);
  await page.locator("#hand .card").first().waitFor();
  return { page, context, errors };
}

async function toggle(page) {
  await page.locator("#toolbar-menu-button").click();
  await page.locator("#menu-button").click();
  const button = page.locator("#metrics-toggle");
  await button.waitFor();
  return button;
}

async function leave({ page, context, errors }) {
  // A real unload may drop the beacon on slow runners; the event is enough.
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  await settle();
  assert.deepEqual(errors, []);
  await context.close();
}

try {
  for (const width of [1440, 390]) {
    // On by default: one batch, a day number and allowlisted totals only.
    const shown = await open("counts-on", width);
    const on = await toggle(shown.page);
    assert.equal(await on.getAttribute("aria-pressed"), "true");
    batches.length = 0;
    await leave(shown);
    assert.equal(batches.length, 1, `one batch at ${width}px`);
    assert.deepEqual(Object.keys(batches[0]).sort(), ["counters", "day"]);
    assert.equal(batches[0].day, Math.floor(Date.now() / 86_400_000));
    assert.equal(batches[0].counters["session.start"], 1);
    assert.equal(batches[0].counters["session.end"], 1);

    // Turned off in Settings: nothing is sent.
    const off = await open("counts-off", width);
    const button = await toggle(off.page);
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    assert.match(await button.textContent(), /play counts: off$/u);
    batches.length = 0;
    await leave(off);
    assert.equal(batches.length, 0, `opt-out sends nothing at ${width}px`);

    // Global Privacy Control: off, and the toggle says why.
    const gpc = await open("counts-gpc", width, { gpc: true });
    const held = await toggle(gpc.page);
    assert.ok(await held.isDisabled());
    assert.match(await held.textContent(), /Global Privacy Control/u);
    batches.length = 0;
    await leave(gpc);
    assert.equal(batches.length, 0, `GPC sends nothing at ${width}px`);
  }
  console.log("Play counts send totals, honour the opt-out and GPC.");
} finally {
  await browser.close();
  server.close();
}
