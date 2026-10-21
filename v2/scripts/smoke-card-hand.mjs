// Browser check for finding your way around the hand: a hand wider than the
// dock shows arrows and scrolls by arrow, wheel and keyboard; the first gift,
// trade and shared journey are each named once, and a dismissed tip stays
// dismissed after a reload.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 700 },
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
  await page.waitForSelector("#hand [data-card]");
  const ready = (id) =>
    page.waitForFunction(
      (id) => !document.querySelector(`#hand [data-card="${id}"]`)?.disabled,
      id,
    );
  const play = async (...ids) => {
    for (const id of ids) {
      await ready(id);
      await page.click(`#hand [data-card="${id}"]`);
    }
    await page.click(`#hand [data-card="${ids.at(-1)}"]`);
  };
  const takeAll = async () => {
    await page.waitForFunction(
      () => document.querySelector("#unveil-dialog").open,
    );
    while (await page.$eval("#unveil-dialog", (d) => d.open)) {
      await page.click("#unveil-take");
      await page.waitForFunction(
        () => !document.querySelector(".unveil-ghost"),
      );
      await page.waitForTimeout(50);
    }
  };
  const tip = () =>
    page.$eval("#hand-tip", (e) =>
      e.hidden ? null : document.querySelector("#hand-tip-text").textContent,
    );
  const scroll = () =>
    page.$eval("#hand", (h) => ({
      left: h.scrollLeft,
      max: h.scrollWidth - h.clientWidth,
    }));

  // Three cards fit: no arrows and no tip yet.
  assert.equal(await page.isVisible("#hand-next"), false);
  assert.equal(await tip(), null);

  await play("lamp");
  await takeAll();
  await play("pond");
  await takeAll();

  // The pond hand overflows: arrows appear, the earlier one disabled.
  assert.ok((await scroll()).max > 0, "the pond hand should overflow");
  assert.equal(await page.isVisible("#hand-next"), true);
  assert.equal(await page.isDisabled("#hand-prev"), true);
  await page.click("#hand-next");
  await page.waitForFunction(
    () => document.querySelector("#hand").scrollLeft > 0,
  );
  await page.waitForFunction(
    () => !document.querySelector("#hand-prev").disabled,
  );
  await page.$eval("#hand", (h) => (h.scrollLeft = h.scrollWidth));
  await page.waitForFunction(
    () => document.querySelector("#hand-next").disabled,
  );

  // The wheel scrolls the hand sideways.
  await page.$eval("#hand", (h) => (h.scrollLeft = 0));
  const box = await page.locator("#hand").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 240);
  await page.waitForFunction(
    () => document.querySelector("#hand").scrollLeft > 0,
  );

  // Arrow keys move between cards.
  await page.focus('#hand [data-card="vale"]');
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.card),
    "lamp",
  );

  // The first gift is named, and its pair is marked.
  assert.equal(await tip(), "Pair the Lamp with Pip to give it.");
  assert.deepEqual(
    await page.$$eval('#hand .card-frame[data-tip="true"] [data-card]', (els) =>
      els.map((e) => e.dataset.card).sort(),
    ),
    ["lamp", "moth"],
  );

  // Dismissed tips stay dismissed across a reload.
  await page.click("#hand-tip-close");
  const trade = await tip();
  assert.match(trade, /^Pair the .+ with the .+ to trade\.$/);
  await page.reload();
  await page.waitForSelector("#hand [data-card]");
  assert.equal(await tip(), trade);

  // Playing the shared journey retires its tip.
  await page.click("#hand-tip-close");
  assert.equal(await tip(), "Pair Pip with Empty station to travel together.");
  await play("moth", "station");
  await page.waitForFunction(
    () => !document.querySelector("#travel").classList.contains("travelling"),
  );
  await page.waitForTimeout(500);
  assert.doesNotMatch((await tip()) ?? "", /travel together/);
  assert.deepEqual(errors, []);
  console.log("card hand smoke passed: overflow arrows, wheel, keys and tips");
} finally {
  await browser.close();
  server.close();
}
