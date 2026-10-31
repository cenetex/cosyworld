import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createServer } from "../card-game/serve.mjs";
import { createWorld, addLog, encodeSave } from "../card-game/world.mjs";
import { enableMotives } from "../card-game/motives.mjs";

const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browserType =
  process.env.COSYWORLD_TEST_BROWSER === "webkit" ? webkit : chromium;
const browser = await browserType.launch({ headless: true });
const evidence = [];
await mkdir("output/scene-video", { recursive: true });
try {
  const sample = await browser.newPage();
  const video = Buffer.from(
    await sample.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext("2d");
      context.fillRect(0, 0, 160, 90);
      const stream = canvas.captureStream(10),
        chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const ready = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      const paint = setInterval(() => context.fillRect(0, 0, 160, 90), 80);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      clearInterval(paint);
      recorder.stop();
      await ready;
      stream.getTracks().forEach((track) => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }),
  );
  await sample.close();
  for (const [width, fallback, slowStart] of [
    [1440, false],
    [390, false],
    [1440, true],
    [1440, false, true],
    [390, true, true],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 700 ? 844 : 900 },
      hasTouch: width < 700,
      isMobile: width < 700,
    });
    const page = await context.newPage(),
      errors = [],
      siteRequests = [],
      videoRequests = [],
      readyMessages = [],
      dialogueRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().startsWith(origin))
        siteRequests.push(
          JSON.stringify({
            url: request.url(),
            headers: request.headers(),
            body: request.postData(),
          }),
        );
    });
    const world = enableMotives(createWorld());
    world.items.lamp.holder = "vale";
    world.items.lamp.lit = true;
    world.items.cloth.holder = "lamp";
    for (const [actorId, speaker, text] of [
      ["vale", "Vale", "The light is under this cloth."],
      ["moth", "Pip", "I can still see the shape of it."],
    ])
      addLog(world, speaker, text, {
        actorId,
        locationId: "station",
        kind: "dialogue",
        generated: true,
        cast: ["vale", "moth"],
      });
    const saved = encodeSave(world);
    await context.addInitScript(
      ({ saved, fallback }) => {
        if (!localStorage.getItem("cosyworld.reflected-shore.v1.camera-check"))
          localStorage.setItem(
            "cosyworld.reflected-shore.v1.camera-check",
            saved,
          );
        if (fallback) window.open = () => null;
      },
      { saved, fallback },
    );
    if (slowStart)
      await context.route("**/openrouter-callback.mjs", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 750));
        await route.continue();
      });
    await context.route("https://openrouter.ai/auth?**", async (route) => {
      const auth = new URL(route.request().url());
      const callback = new URL(auth.searchParams.get("callback_url"));
      assert.equal(
        callback.searchParams.get("state"),
        auth.searchParams.get("state"),
      );
      callback.searchParams.set("code", "provider-code-without-state-echo");
      if (slowStart)
        callback.search = new URLSearchParams({
          code: "provider-code-with-state-echo",
          state: auth.searchParams.get("state"),
        }).toString();
      await route.fulfill({
        contentType: "text/html",
        headers: { "Cross-Origin-Opener-Policy": "same-origin" },
        body: `<a id="authorize" href="${callback.href.replaceAll("&", "&amp;")}">Authorize</a>`,
      });
    });
    await context.route("https://openrouter.ai/api/v1/**", async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      };
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      if (path.endsWith("auth/keys")) {
        assert.equal(request.postDataJSON().code_challenge_method, "S256");
        return route.fulfill({
          json: { key: "sk-or-camera-browser-test-credential" },
          headers,
        });
      }
      if (path.endsWith("videos/models"))
        return route.fulfill({
          json: {
            data: [
              {
                id: "tbc/mischief-1",
                supported_durations: [3, 5],
                supported_resolutions: ["720p"],
                supported_aspect_ratios: ["16:9"],
                supported_frame_images: ["first_frame"],
              },
            ],
          },
          headers,
        });
      if (path.endsWith("/videos")) {
        videoRequests.push(request.postDataJSON());
        return route.fulfill({
          json: { id: "camera-video", status: "pending" },
          headers,
        });
      }
      if (path.endsWith("camera-video/content"))
        return route.fulfill({
          body: video,
          contentType: "video/webm",
          headers,
        });
      if (path.endsWith("camera-video"))
        return route.fulfill({
          json: { id: "camera-video", status: "completed" },
          headers,
        });
      return route.fulfill({ json: { data: [] }, headers });
    });
    await context.route(`${origin}/card-game/text`, async (route) => {
      dialogueRequests.push(route.request().headers());
      await route.fulfill({ json: { entries: [] } });
    });
    await page.goto(`${origin}/?table=camera-check`);
    await page.locator("body:not([inert])").waitFor();
    await page.exposeFunction("recordSignInReady", () =>
      readyMessages.push(true),
    );
    await page.evaluate(() => {
      window.addEventListener("message", (event) => {
        if (
          event.origin === location.origin &&
          event.data?.type === "cosy-openrouter-ready"
        )
          void window.recordSignInReady();
      });
    });
    await page.locator("#toolbar-menu-button").click();
    await page.locator("#menu-button").click();
    const gameUrl = page.url();
    const before = await page.evaluate(() =>
      localStorage.getItem("cosyworld.reflected-shore.v1.camera-check"),
    );
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    if (fallback) {
      await page.locator("#openrouter-connect").click();
      await page.waitForURL("https://openrouter.ai/auth?**");
      await page.locator("#authorize").click();
      await page.locator("#openrouter-options").waitFor({ state: "visible" });
      await page.locator("body:not([inert])").waitFor();
      assert.equal(page.url(), gameUrl);
    } else {
      const opened = page.waitForEvent("popup");
      await page.locator("#openrouter-connect").click();
      const popup = await opened;
      await popup.waitForURL("https://openrouter.ai/auth?**");
      assert.equal(readyMessages.length, 1);
      await popup.locator("#authorize").click();
      await page.locator("#openrouter-options").waitFor({ state: "visible" });
      assert.equal(page.url(), gameUrl);
      assert.equal(navigations, 0);
    }
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("cosyworld.reflected-shore.v1.camera-check"),
      ),
      before,
    );
    assert.equal(await page.locator("#openrouter-chat").count(), 0);
    await page.evaluate(async () => {
      const { requestNarrative } = await import("/card-game/narrative.mjs");
      await requestNarrative({ entities: [] });
    });
    assert.equal(dialogueRequests.length, 1);
    assert.equal(dialogueRequests[0].authorization, undefined);
    assert.equal(dialogueRequests[0]["x-cosy-browser-chat"], undefined);
    await page.locator('[data-close="menu-dialog"]').click();
    for (
      let i = 0;
      i < 4 && (await page.locator("#speaker").textContent()) !== "Pip";
      i++
    )
      await page.locator("#dialogue-advance").click();
    await page.locator("#scene-video-button").hover();
    assert.equal(videoRequests.length, 0);
    await page.locator("#scene-video-button").click();
    await page
      .getByText("Your scene video is ready.", { exact: true })
      .waitFor();
    assert.equal(videoRequests.length, 1);
    assert.equal(videoRequests[0].model, "tbc/mischief-1");
    assert.equal(videoRequests[0].duration, 5);
    assert(videoRequests[0].prompt.includes("The light is under this cloth."));
    assert(
      videoRequests[0].prompt.includes("I can still see the shape of it."),
    );
    assert(videoRequests[0].prompt.includes('"holder":"Vale"'));
    assert(videoRequests[0].prompt.includes('"covered":true'));
    assert(
      videoRequests[0].frame_images[0].image_url.url.startsWith(
        "data:image/jpeg;base64,",
      ),
    );
    const dimensions = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, videoRequests[0].frame_images[0].image_url.url);
    assert.deepEqual(dimensions, [1280, 720]);
    await page.locator("#scene-video-player").evaluate(async (player) => {
      player.loop = true;
      await player.play();
      player.pause();
    });
    await page.screenshot({
      path: `output/scene-video/${width}-${fallback ? "same-tab" : slowStart ? "slow-window" : "window"}.png`,
    });
    assert(
      !(await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )),
    );
    assert(
      siteRequests.every(
        (request) => !request.includes("sk-or-camera-browser-test-credential"),
      ),
    );
    assert.deepEqual(errors, []);
    evidence.push({
      width,
      fallback,
      slowStart: Boolean(slowStart),
      gameKept: true,
      connected: true,
      contextVideo: true,
      keyStayedInBrowser: true,
      serverDialogue: true,
    });
    await context.close();
  }
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
