import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { selectCard } from "./card-browser-helpers.mjs";
const origin =
  process.env.COSYWORLD_LOCAL_SMOKE_ORIGIN || "http://127.0.0.1:3110";
const output = new URL("../../output/local-app/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      localStorage.setItem(
        "cosyworld.room-music",
        JSON.stringify({ enabled: false }),
      );
      localStorage.setItem("cosyworld.dialogue.sound", "on");
      const original = fetch.bind(window);
      window.testVoiceRequests = [];
      window.testStory = {};
      const event = (v) =>
        new TextEncoder().encode("data: " + JSON.stringify(v) + "\n\n");
      window.fetch = (input, options = {}) => {
        const path =
          typeof input === "string" ? input : new URL(input.url).pathname;
        if (path === "/card-game/local/speech") {
          window.testVoiceRequests.push({
            at: performance.now(),
            ...JSON.parse(options.body),
          });
          const b = new Uint8Array(4844),
            d = new DataView(b.buffer),
            t = (s, p) => [...s].forEach((c, i) => (b[p + i] = c.charCodeAt()));
          t("RIFF", 0);
          d.setUint32(4, b.length - 8, true);
          t("WAVEfmt ", 8);
          d.setUint32(16, 16, true);
          d.setUint16(20, 1, true);
          d.setUint16(22, 1, true);
          d.setUint32(24, 24000, true);
          d.setUint32(28, 48000, true);
          d.setUint16(32, 2, true);
          d.setUint16(34, 16, true);
          t("data", 36);
          d.setUint32(40, b.length - 44, true);
          return Promise.resolve(
            new Response(b, { headers: { "Content-Type": "audio/wav" } }),
          );
        }
        if (path === "/card-game/reflections")
          return Promise.resolve(
            new Response(
              event({
                type: "complete",
                revision: JSON.parse(options.body).revision,
                reflections: [],
              }),
              { headers: { "Content-Type": "text/event-stream" } },
            ),
          );
        if (path === "/card-game/text") {
          const c = JSON.parse(options.body),
            line = {
              id: c.speakers[0],
              text: "The lamp is warm. Come sit beside me.",
            };
          window.testStory = { started: performance.now(), complete: false };
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  setTimeout(
                    () =>
                      controller.enqueue(
                        event({
                          type: "delta",
                          text: JSON.stringify(line) + "\n",
                        }),
                      ),
                    100,
                  );
                  setTimeout(() => {
                    window.testStory.complete = true;
                    controller.enqueue(
                      event({
                        type: "complete",
                        revision: c.revision,
                        model: "fixture",
                        entries: [line],
                        omitted: c.entities
                          .filter((e) => e.id !== line.id)
                          .map((e) => e.id),
                      }),
                    );
                    controller.close();
                  }, 2500);
                },
              }),
              { headers: { "Content-Type": "text/event-stream" } },
            ),
          );
        }
        return original(input, options);
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      origin + "/?table=stream-check-" + width + "-" + Date.now(),
    );
    await page.waitForFunction(() => !document.body.inert);
    await page.waitForTimeout(3200);
    // The opening cards start covered; the helper uncovers, then selects.
    await selectCard(page, "vale");
    await selectCard(page, "lamp");
    // The opening starts lit; dousing the lamp is its first play (#1653).
    await page.locator('#card-actions button[data-action="snuff"]').click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#dialogue-text")
          ?.textContent.includes("The lamp is warm."),
      { timeout: 10000 },
    );
    const result = await page.evaluate(() => ({
      beforeComplete: !testStory.complete,
      visibleMs: performance.now() - testStory.started,
      firstVoiceMs:
        testVoiceRequests.find(
          (x) => x.text === "The lamp is warm. Come sit beside me.",
        )?.at - testStory.started,
      requests: testVoiceRequests.filter(
        (x) => x.text === "The lamp is warm. Come sit beside me.",
      ),
    }));
    await page.waitForTimeout(2800);
    result.requests = await page.evaluate(() =>
      testVoiceRequests.filter(
        (x) => x.text === "The lamp is warm. Come sit beside me.",
      ),
    );
    result.errors = errors;
    result.width = width;
    assert(
      result.beforeComplete,
      "The first line appears during the scene stream.",
    );
    assert(
      result.firstVoiceMs < 500,
      "Speech starts from the early validated line.",
    );
    assert.equal(
      result.requests.length,
      1,
      "One voice request serves preparation and playback.",
    );
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result));
    await page.screenshot({
      path: new URL("stream-" + width + ".png", output).pathname,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
