// Browser check for meeting new cards: lighting the lamp unveils the Black pond
// card large, it flies into the hand, and playing it dips the scene to dark
// with the destination's name before the pond appears.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/card-game/text", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"Story service paused for local check."}',
    }),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/card-game/`);
  const cards = () =>
    page.$$eval("#hand [data-card]", (els) => els.map((e) => e.dataset.card));
  const play = async (id) => {
    const card = page.locator(`#hand [data-card="${id}"]`);
    await assert.doesNotReject(card.waitFor());
    await page.waitForFunction(
      (id) => !document.querySelector(`#hand [data-card="${id}"]`)?.disabled,
      id,
    );
    await card.click();
    await card.click();
  };

  assert.deepEqual((await cards()).includes("pond"), false);
  await play("lamp");
  await page.waitForFunction(
    () => document.querySelector("#unveil-dialog").open,
  );
  assert.equal(await page.textContent("#unveil-eyebrow"), "A new place");
  assert.equal(
    await page.getAttribute("#unveil-card [data-card]", "data-card"),
    "pond",
  );
  // The place stays the attic: lighting the lamp opens a path, it does not move Vale.
  assert.equal(await page.textContent("#place-title"), "Mirror attic");

  await page.click("#unveil-take");
  await page.waitForFunction(() => !document.querySelector(".unveil-ghost"));
  assert.ok((await cards()).includes("pond"));
  assert.ok(
    await page.$eval('#hand [data-card="pond"]', (e) =>
      e.classList.contains("new"),
    ),
  );

  await play("pond");
  await page.waitForFunction(() =>
    document.querySelector("#travel").classList.contains("travelling"),
  );
  assert.equal(await page.textContent("#travel-name"), "Black pond");
  await page.waitForFunction(
    () => document.querySelector("#place-title").textContent === "Black pond",
  );
  // Arriving meets Pip and what Pip carries; each is unveiled in turn.
  await page.waitForFunction(
    () => document.querySelector("#unveil-dialog").open,
  );
  const met = [];
  while (await page.$eval("#unveil-dialog", (d) => d.open)) {
    met.push(await page.getAttribute("#unveil-card [data-card]", "data-card"));
    await page.click("#unveil-take");
    await page.waitForFunction(() => !document.querySelector(".unveil-ghost"));
    await page.waitForTimeout(50);
  }
  assert.ok(met.includes("moth"), `met ${met.join(", ")}`);
  for (const id of met) assert.ok((await cards()).includes(id));

  // A reload does not unveil cards already met.
  await page.reload();
  await page.waitForSelector("#hand [data-card]");
  await page.waitForTimeout(300);
  assert.equal(await page.$eval("#unveil-dialog", (d) => d.open), false);
  assert.deepEqual(errors, []);
  console.log(`card unveil smoke passed: met pond, ${met.join(", ")}`);
} finally {
  await browser.close();
  server.close();
}
