// Android phones, landscape, tablets and a Chromebook: the hand, the top bar
// and the dialogue fit the screen, and a WebView that blocks storage still
// plays a fresh world in the tab.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { revealCard } from "./card-browser-helpers.mjs";

const android = (width, height, scale) => ({
  viewport: { width, height },
  deviceScaleFactor: scale,
  isMobile: true,
  hasTouch: true,
  userAgent: devices["Pixel 7"].userAgent,
});
const profiles = {
  "pixel-7": devices["Pixel 7"],
  "galaxy-s9": devices["Galaxy S9+"],
  "low-end-360x740": android(360, 740, 3),
  "small-360x640": android(360, 640, 2),
  // Android's 130% text size zooms the page: a Pixel 7 lays out 317px wide.
  "pixel-7-text-130": android(317, 704, 3.4),
  "landscape-740x360": android(740, 360, 3),
  "galaxy-tab-portrait": devices["Galaxy Tab S4"],
  "ipad-mini-landscape": devices["iPad Mini landscape"],
  chromebook: { viewport: { width: 1366, height: 768 } },
};

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const output = new URL(
  process.env.DEVICE_SHOTS || "../../output/devices/",
  import.meta.url,
);
await mkdir(output, { recursive: true });

async function open(name, profile, { blockStorage = false } = {}) {
  const context = await browser.newContext(profile);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((blockStorage) => {
    if (blockStorage) {
      // In-app browsers with DOM storage off refuse every access.
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        },
      });
      return;
    }
    localStorage.setItem("cosyworld.dialogue.sound", "off");
    localStorage.setItem("cosyworld.room-music", JSON.stringify({ enabled: false }));
  }, blockStorage);
  await page.route("**/card-game/text", (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        revision: input.revision,
        model: "device-fixture",
        entries: input.entities.map(({ id }) => ({ id, text: "Where am I?" })),
      }),
    });
  });
  await page.goto(`${origin}/?table=devices-${name}`);
  await page.waitForFunction(
    () => document.querySelector("#hand").dataset.cooling === "false",
  );
  return { context, page, errors };
}

try {
  for (const [name, profile] of Object.entries(profiles)) {
    const { context, page, errors } = await open(name, profile);
    try {
      await revealCard(page, "vale");
      await revealCard(page, "attic");
      await page.locator("#speech-row:not([hidden])").waitFor();
      const fit = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const width = innerWidth,
          height = innerHeight;
        const frame = box(document.querySelector("#hand .card-frame:not([hidden])"));
        const label = box(document.querySelector("#hand .card .name"));
        const controls = [...document.querySelectorAll(".topbar button")]
          .filter((el) => el.offsetParent)
          .map(box);
        const speech = box(document.getElementById("speech-row"));
        return {
          width,
          height,
          scrollWidth: document.documentElement.scrollWidth,
          frameTop: frame.top,
          shown: (Math.min(frame.bottom, height) - frame.top) / frame.height,
          labelBottom: label.bottom,
          controlsInside: controls.every(
            (b) => b.left >= 0 && b.right <= width && b.top >= 0,
          ),
          speechInside: speech.left >= 0 && speech.right <= width && speech.top > 0,
          speechClear:
            speech.bottom <= frame.top + 2 ||
            speech.right <= frame.left ||
            speech.left >= frame.right,
        };
      });
      const where = `${name} ${fit.width}x${fit.height}`;
      assert.equal(fit.scrollWidth, fit.width, `${where}: page scrolls sideways`);
      // The hand tucks its bottom quarter under the screen edge, never more.
      assert(fit.shown >= 0.7, `${where}: only ${fit.shown} of a card shows`);
      // The name's box ends on the tuck line, so a leaning card's corner may
      // round a fraction of a pixel past the edge.
      assert(fit.labelBottom <= fit.height + 1, `${where}: card name is off screen`);
      assert(fit.controlsInside, `${where}: a top-bar control is off screen`);
      assert(fit.speechInside, `${where}: the dialogue is off screen`);
      assert(fit.speechClear, `${where}: the dialogue covers the hand`);
      assert.deepEqual(errors, [], `${where}: page errors`);
      await page.screenshot({ path: new URL(`${name}.png`, output).pathname });
    } finally {
      await context.close();
    }
  }

  // Storage blocked: the opening still plays, with the unsaved-tab status line.
  const { context, page, errors } = await open("no-storage", profiles["low-end-360x740"], {
    blockStorage: true,
  });
  try {
    assert.match(await page.locator("#play-status").textContent(), /could not save the world/);
    assert.equal(await page.locator("#place-title").textContent(), "…");
    await revealCard(page, "vale");
    await revealCard(page, "attic");
    await page.locator("#speech-row:not([hidden])").waitFor();
    const lamp = await revealCard(page, "lamp");
    await lamp.click();
    await page.locator("#card-actions button:visible:enabled").first().waitFor();
    assert.deepEqual(errors, [], "page errors with storage blocked");
  } finally {
    await context.close();
  }
  console.log(`Device fit passed on ${Object.keys(profiles).length} screens and with storage blocked.`);
} finally {
  await browser.close();
  server.close();
}
