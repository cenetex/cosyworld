// Open the existing workspace and descriptor before a play session starts.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "../card-game/serve.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
await mkdir("output/card-descriptor", { recursive: true });
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 320 ? 568 : 900 },
      reducedMotion: "reduce",
    });
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    await page.route("**/entry.mjs", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: "document.body.inert = false;",
      }),
    );
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const { renderCardDescriptor } = await import(
        "/card-game/card-descriptor.mjs"
      );
      const { installCardWorkspace } = await import(
        "/card-game/settings-screen.mjs"
      );
      const beat = { cards: [], buttons: [{ label: "Save", run() {} }] };
      renderCardDescriptor(beat);
      const button = document.querySelector("#card-actions button");
      renderCardDescriptor(beat);
      if (
        button !== document.querySelector("#card-actions button") ||
        button.id !== ""
      )
        throw new Error("An unnamed context button must stay through redraws.");
      localStorage.setItem("cosyworld.playing", "saved-play");
      new ResizeObserver(([entry]) => {
        document.documentElement.style.setProperty(
          "--dock-height",
          `${entry.target.getBoundingClientRect().height}px`,
        );
      }).observe(document.querySelector(".play-dock"));
      const cards = [
        {
          id: "world",
          name: "World",
          art: "assets/card-back.webp",
          lit: true,
          group: true,
        },
        {
          id: "location",
          name: "Starting location",
          art: "assets/station.png",
          lit: true,
          holder: "world",
        },
      ];
      let saved = false;
      const workspace = installCardWorkspace({
        cards: () => cards,
        label: "World editor",
        initialGroup: "world",
        actionBeat: {
          show(beat) {
            renderCardDescriptor(beat);
            document.querySelector("#action-beat").hidden = false;
            const dialogue = document.querySelector(".dialogue");
            dialogue.hidden = false;
            dialogue.dataset.action = "true";
            document.body.dataset.handExpanded = "true";
            document.body.dataset.dialogueOver = "true";
          },
          clear() {
            document.querySelector("#action-beat").hidden = true;
          },
        },
        describe: (_cards, chosen) => ({
          name: chosen ? "Starting location" : "World editor",
          note: saved
            ? "Starting location saved."
            : "Choose the starting location.",
          actions: chosen
            ? [{ label: "Start here", run: "start", stays: true }]
            : [],
        }),
        run() {
          saved = true;
        },
      });
      workspace.open();
    });
    await page.locator('[data-setting="location"]').click();
    await page.locator("#setting-location").click();
    await page.waitForFunction(
      () =>
        document.querySelector(".action-beat-note").textContent ===
        "Starting location saved.",
    );
    assert.equal(await page.locator("#card-actions button").count(), 1);
    assert.equal(
      await page.locator("#setting-location").getAttribute("data-keep-menu"),
      "true",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("cosyworld.playing")),
      "saved-play",
    );
    assert.equal(
      requests.some((url) => /\/app\.mjs(?:\?|$)/u.test(url)),
      false,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `output/card-descriptor/${width}.png` });
    await page.close();
    console.log(`standalone descriptor: ${width}px passed`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
